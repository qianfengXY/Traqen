"use client";
import type { Investigation } from "./types.ts";
import { investigationKind } from "./investigation-kind.ts";
import { openWork } from "./work-route.ts";

export function InvestigationTypeNotice({ run }: { run: Investigation }) {
  const type = investigationKind(run);
  return (
    <section className="bk-panel" aria-label="运行类型与精确入口">
      <h2>
        {type.kind === "QUESTION"
          ? "这是图谱问答运行，不是业务调查"
          : "运行类型未识别，未作为业务调查展示"}
      </h2>
      <p>
        {run.question} · {type.state}
      </p>
      <p>
        运行 <code>{run.id}</code> · 类型{" "}
        <code>{typeof run.purpose === "string" ? run.purpose : "未记录／未知格式"}</code>
      </p>
      {type.kind === "QUESTION" && (
        <p>
          COMPLETED仅代表派生答案已保存，不是业务分析图谱、人工确认或可信执行通过。问答不能在此补证或采用技术版本。
        </p>
      )}
      {type.position ? (
        <button className="button" onClick={() => openWork(run.workspaceId, type.position!)}>
          打开所属会话的精确问题
        </button>
      ) : (
        <p>所属会话坐标缺失、类型未知或与运行绑定不符；未猜测最新会话，不会扩大私有调查权限。</p>
      )}
    </section>
  );
}
