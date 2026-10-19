"use client";
import { authCall } from "./auth-client";
import { useIdentity } from "./auth-session";
import type { RunAction } from "./access-types";
export type Device = {
  id: string;
  device: string;
  current: boolean;
  revoked: boolean;
  createdAt: number;
  lastActivity: number;
  expiresAt: number;
};
export function Security({
  devices,
  run,
  busy,
  refresh,
}: {
  devices: Device[];
  run: RunAction;
  busy: boolean;
  refresh: () => Promise<void>;
}) {
  const identity = useIdentity();
  return (
    <>
      <div className="f008-grid">
        <section className="panel">
          <h2>登录设备与会话</h2>
          <p>普通会话最长 12 小时、空闲 2 小时；记住设备最长 30 天、空闲 7 天。后台轮询不续期。</p>
          <table>
            <thead>
              <tr>
                <th>设备</th>
                <th>最近活动</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {devices
                .filter((device) => !device.revoked)
                .map((device) => (
                  <tr key={device.id}>
                    <td>
                      {device.device}
                      <small>{device.current ? "当前设备" : "其他设备"}</small>
                    </td>
                    <td>
                      {new Date(device.lastActivity).toLocaleString()}
                      <small>到期：{new Date(device.expiresAt).toLocaleString()}</small>
                    </td>
                    <td>
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            if (device.current) await identity.logout();
                            else {
                              await authCall("/v1/auth/sessions/revoke", "POST", { id: device.id });
                              await refresh();
                            }
                          })
                        }
                      >
                        退出此设备
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <button
            className="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await authCall("/v1/auth/sessions/revoke", "POST", { id: "others" });
                await refresh();
              })
            }
          >
            退出其他设备
          </button>
        </section>
        <aside className="panel">
          <h2>重新验证身份</h2>
          <p>修改密码与管理员资格等敏感操作要求最近 10 分钟内验证。验证后，请重新读取状态并再次提交原操作。</p>
          <form
            className="f008-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void run(async () => {
                await authCall("/v1/auth/reauthenticate", "POST", {
                  password: form.get("password"),
                });
                await identity.refresh();
                await refresh();
              });
            }}
          >
            <label>
              当前密码
              <input name="password" type="password" autoComplete="current-password" required />
            </label>
            <button className="button primary" disabled={busy}>
              验证身份
            </button>
          </form>
        </aside>
      </div>
      <div className="f008-grid">
        <section className="panel">
          <h2>修改密码</h2>
          <form
            className="f008-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void run(async () => {
                if (form.get("password") !== form.get("repeat")) throw new Error("两次输入的密码不一致");
                await authCall("/v1/auth/password", "POST", { password: form.get("password") });
                await identity.refresh();
                await refresh();
              });
            }}
          >
            <label>
              新密码
              <input name="password" type="password" minLength={8} autoComplete="new-password" required />
            </label>
            <label>
              确认新密码
              <input name="repeat" type="password" minLength={8} autoComplete="new-password" required />
            </label>
            <p>至少 8 个字符，无需定期更换。修改后其他会话失效。</p>
            <button className="button primary" disabled={busy}>
              保存密码
            </button>
          </form>
        </section>
      </div>
    </>
  );
}
