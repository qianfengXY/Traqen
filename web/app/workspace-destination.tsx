"use client";
import { useEffect, useState } from "react";
import { authCall, openAccess } from "./auth-client";
export function WorkspaceDestination({workspaceId}: {workspaceId:string}) {
  const [discoverable, setDiscoverable] = useState(false);
  useEffect(() => {
    let active = true;
    const entry = new URLSearchParams(location.search).get("entry");
    void authCall<{spaces:Array<{id:string}>}>(`/v1/access/directory${entry ? `?entry=${encodeURIComponent(entry)}` : ""}`)
      .then(result => { if (active) setDiscoverable(result.spaces.some(space => space.id === workspaceId)); })
      .catch(() => { if (active) setDiscoverable(false); });
    return () => { active = false; };
  }, [workspaceId]);
  return <section className="panel destination-state"><h1>无法访问此空间</h1>
    <p>链接目标可能不可用或当前账号未获授权；不会切换到其他空间。</p>
    {discoverable && <button className="button primary" onClick={() => openAccess("join", workspaceId)}>申请权限</button>}
    <button className="button" onClick={() => openAccess("spaces")}>返回我的空间</button>
    <button className="button" onClick={() => openAccess("directory")}>浏览可申请空间</button>
  </section>;
}
