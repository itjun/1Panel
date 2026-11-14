import { useMemo, type CSSProperties } from "react";
import { paletteTokens } from "@/react/lib/color-palettes";
import { diffContext, diffTextLines } from "@/react/lib/text-diff";

export function SshConfigDiff({ before, after }: { before: string; after: string }) {
  const rows = useMemo(() => diffTextLines(before, after), [before, after]);
  const context = useMemo(() => diffContext(rows), [rows]);
  const removed = rows.filter((row) => row.kind === "removed").length;
  const added = rows.filter((row) => row.kind === "added").length;
  return (
    <div className="config-ssh-diff" style={paletteTokens("classic", "dark") as CSSProperties}>
      <div className="config-ssh-diff-legend">
        <span className="config-ssh-diff-before">− 应用记录（{removed} 行）</span>
        <span className="config-ssh-diff-after">+ 本机文件（{added} 行）</span>
      </div>
      <div className="config-ssh-diff-scroll" tabIndex={0} role="region" aria-label="SSH 配置差异">
        <table>
          <thead><tr><th scope="col">应用</th><th scope="col">本机</th><th scope="col" aria-label="变化" /><th scope="col">内容</th></tr></thead>
          <tbody>{context.map((row, index) => typeof row === "number" ? (
            <tr key={index} className="config-ssh-diff-context"><td colSpan={4}>⋯ {row} 行相同内容</td></tr>
          ) : (
            <tr key={index} data-line-kind={row.kind}>
              <td>{row.beforeLine}</td><td>{row.afterLine}</td>
              <td>{row.kind === "removed" ? "−" : row.kind === "added" ? "+" : ""}</td>
              <td><code>{row.text.replace(/[\r\n]+$/, "") || " "}</code>
                {row.kind !== "same" && (!row.text.endsWith("\n") || row.text.endsWith("\r\n")) ? (
                  <small className="config-ssh-diff-ending">{row.text.endsWith("\r\n") ? "CRLF" : row.text.endsWith("\r") ? "CR" : "无末尾换行"}</small>
                ) : null}
              </td>
            </tr>
          ))}</tbody>
        </table>
        {!removed && !added ? <p className="text-reader-placeholder">文件内容相同，文件状态有变化。</p> : null}
      </div>
    </div>
  );
}
