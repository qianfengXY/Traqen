"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { authCall, prepareLogin, setSessionProof, type AuthSession, IdentityError } from "./auth-client";
import { ThemeSwitcher } from "./components/ui/theme-switcher";
import { desktopScale } from "./product-navigation";
import "./auth.css";

type IdentityContext = { session: AuthSession; refresh: () => Promise<void>; logout: () => Promise<void> };
const Context = createContext<IdentityContext | null>(null);
export function useIdentity() {
  const value = useContext(Context);
  if (!value) throw new Error("登录上下文尚未就绪");
  return value;
}
export const errorText = (error: unknown) =>
  error instanceof Error ? error.message : "连接中断，结果未确认，请先刷新状态";

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthSession | null>(null),
    [state, setState] = useState("CHECKING"),
    [issue, setIssue] = useState("");
  const channel = useRef<BroadcastChannel | null>(null),
    accountId = useRef<string | null>(null);
  const refresh = useCallback(async () => {
    try {
      const status = await authCall<{ initialized: boolean; recovery: boolean }>("/v1/auth/status");
      if (!status.initialized) {
        setSession(null);
        setState("UNINITIALIZED");
        return;
      }
      const current = await authCall<AuthSession>("/v1/auth/session");
      if (accountId.current && accountId.current !== current.account.id) {
        window.history.replaceState(null, "", "/");
        window.dispatchEvent(new Event("traqen:navigate"));
      }
      if (!window.location.search && current.position !== "/") {
        window.history.replaceState(null, "", current.position);
        window.dispatchEvent(new Event("traqen:navigate"));
      }
      accountId.current = current.account.id;
      setSession(current);
      setState(current.session.phase);
      setIssue("");
    } catch (error) {
      setSession(null);
      if (
        error instanceof IdentityError &&
        ["AUTH_REQUIRED", "AUTH_SESSION_EXPIRED", "AUTH_SESSION_REVOKED", "AUTH_ACCOUNT_DISABLED"].includes(error.code)
      ) {
        setState(error.code === "AUTH_ACCOUNT_DISABLED" ? "DISABLED" : "LOGIN");
        if (error.code !== "AUTH_REQUIRED") setIssue(error.message);
      } else {
        setState(error instanceof IdentityError && error.code === "AUTH_RECOVERY_REQUIRED" ? "RECOVERY" : "ERROR");
        setIssue(errorText(error));
      }
    }
  }, []);
  useEffect(() => {
    try {
      accountId.current = sessionStorage.getItem("traqen.accountId");
      localStorage.removeItem("traqen.activeWorkspaceId");
    } catch {
      /* Optional browser storage contains no credential. */
    }
    const initial = setTimeout(() => void refresh(), 0);
    const lost = (event: Event) => {
      setSession(null);
      setState((event as CustomEvent).detail?.code === "AUTH_ACCOUNT_DISABLED" ? "DISABLED" : "LOGIN");
      setIssue((event as CustomEvent).detail?.message ?? "请重新登录，已提交操作不会自动重试");
    };
    const focus = () => {
      void refresh();
    };
    window.addEventListener("traqen:session-lost", lost);
    window.addEventListener("focus", focus);
    if (typeof BroadcastChannel !== "undefined") {
      channel.current = new BroadcastChannel("traqen.identity");
      channel.current.onmessage = () => {
        setSession(null);
        void refresh();
      };
    }
    return () => {
      clearTimeout(initial);
      window.removeEventListener("traqen:session-lost", lost);
      window.removeEventListener("focus", focus);
      channel.current?.close();
    };
  }, [refresh]);
  useEffect(() => {
    if (session?.session.phase !== "AUTHENTICATED") return;
    let last = 0;
    const activity = () => {
      if (Date.now() - last < 60000) return;
      last = Date.now();
      void authCall("/v1/auth/activity", "POST", {}).catch(() => {});
    };
    window.addEventListener("pointerdown", activity);
    window.addEventListener("keydown", activity);
    return () => {
      window.removeEventListener("pointerdown", activity);
      window.removeEventListener("keydown", activity);
    };
  }, [session?.session.phase]);
  const loggedIn = async () => {
    await refresh();
    const current = await authCall<AuthSession>("/v1/auth/session");
    const prior = accountId.current; // refresh has already cleared another account's URL.
    if (!window.location.search && current.position !== "/" && (!prior || prior === current.account.id)) {
      window.history.replaceState(null, "", current.position);
      window.dispatchEvent(new Event("traqen:navigate"));
    }
    try {
      sessionStorage.setItem("traqen.accountId", current.account.id);
    } catch {
      /* Optional. */
    }
    channel.current?.postMessage("changed");
  };
  const logout = async () => {
    await authCall("/v1/auth/logout", "POST", {});
    setSessionProof("");
    setSession(null);
    setState("LOGIN");
    setIssue("已退出此设备");
    channel.current?.postMessage("changed");
  };
  if (session && state === "AUTHENTICATED")
    return (
      <Context.Provider value={{ session, refresh, logout }}>
        <div key={session.account.id}>{children}</div>
      </Context.Provider>
    );
  return <AuthenticationScreen state={state} issue={issue} onReady={loggedIn} onRetry={refresh} />;
}

function AuthenticationScreen({
  state,
  issue,
  onReady,
  onRetry,
}: {
  state: string;
  issue: string;
  onReady: () => Promise<void>;
  onRetry: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [setup, setSetup] = useState<{ secret: string; recoveryCodes: string[]; uri: string } | null>(null),
    [scale, setScale] = useState(1),
    [passwordDone, setPasswordDone] = useState(false);
  const [credential, setCredential] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      const value = new URLSearchParams(window.location.hash.slice(1)).get("credential");
      if (value) {
        setCredential(value);
        window.history.replaceState(null, "", window.location.pathname + window.location.search);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    const resize = () => setScale(desktopScale(innerWidth, innerHeight));
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const login = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await prepareLogin();
      await authCall("/v1/auth/login", "POST", {
        login: form.get("login"),
        password: form.get("password"),
        remember: form.get("remember") === "on",
        device: navigator.userAgent.slice(0, 160),
      });
      await onReady();
    });
  };
  const verify = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      await authCall(setup ? "/v1/auth/totp/confirm" : "/v1/auth/totp/verify", "POST", {
        code: String(form.get("code")).trim(),
      });
      setSetup(null);
      await onReady();
    });
  };
  const setPassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      if (form.get("password") !== form.get("repeat")) throw new Error("两次输入的密码不一致");
      await prepareLogin();
      await authCall("/v1/auth/set-password", "POST", { credential, password: form.get("password") });
      window.history.replaceState(null, "", "/");
      setPasswordDone(true);
    });
  };
  const enrol = state === "MFA_ENROLLMENT_REQUIRED",
    mfa = state === "MFA_REQUIRED";
  const title =
    credential && !passwordDone
      ? "设置或恢复密码"
      : enrol
        ? "绑定两步验证"
        : mfa
          ? "完成两步验证"
          : state === "UNINITIALIZED"
            ? "先完成部署设置"
            : state === "RECOVERY"
              ? "实例恢复检查中"
              : state === "DISABLED"
                ? "账号已停用"
                : state === "ERROR"
                  ? "暂时无法连接"
                  : state === "CHECKING"
                    ? "正在检查登录状态"
                    : "欢迎回到 Traqen";
  return (
    <div className="auth-frame" style={{ "--desktop-scale": scale } as React.CSSProperties}>
      <main className="auth-canvas">
        <header className="auth-top">
          <span className="brand">
            <span className="brand-mark">Ŧ</span>Traqen
          </span>
          <ThemeSwitcher ariaLabel="主题配色" />
        </header>
        <section className="auth-intro">
          <p className="eyebrow">YOUR WORK, CONNECTED</p>
          <h1>
            登录一次，
            <br />
            回到上次工作的地方。
          </h1>
          <p>
            从来源、证据到业务理解，
            <br />
            每一次继续，都有清晰的上下文。
          </p>
          <div className="auth-path">
            <span>登录 Traqen</span>
            <i>→</i>
            <span>选择空间</span>
            <i>→</i>
            <span>继续工作</span>
          </div>
          <small>空间权限由各空间的管理者授予。</small>
        </section>
        <section className="auth-card" aria-labelledby="auth-title">
          <p className="eyebrow">TRAQEN ACCOUNT</p>
          <h2 id="auth-title">{title}</h2>
          {(error || issue) && (
            <p className="auth-notice" role="alert">
              {error || issue}
            </p>
          )}
          {passwordDone && <p role="status">密码已更新，请使用新密码登录。</p>}
          {credential && !passwordDone ? (
            <form onSubmit={setPassword}>
              <label>
                新密码
                <input name="password" type="password" autoComplete="new-password" minLength={8} required />
              </label>
              <label>
                确认密码
                <input name="repeat" type="password" autoComplete="new-password" minLength={8} required />
              </label>
              <p>至少 8 个字符，无需定期更换。</p>
              <button className="button primary" disabled={busy}>
                保存密码
              </button>
            </form>
          ) : enrol || mfa ? (
            <>
              {enrol && !setup ? (
                <>
                  <p>系统管理员必须完成验证器绑定后才能进入管理面。</p>
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        setSetup(await authCall("/v1/auth/totp/begin", "POST", {}));
                      })
                    }
                  >
                    开始绑定
                  </button>
                </>
              ) : (
                <>
                  {setup && (
                    <>
                      <p>在验证器中输入设置密钥：</p>
                      <code className="auth-secret">{setup.secret}</code>
                      <p>将下列一次性恢复码保存到安全位置，离开后不再显示。</p>
                      <div className="auth-codes">
                        {setup.recoveryCodes.map((code) => (
                          <code key={code}>{code}</code>
                        ))}
                      </div>
                    </>
                  )}
                  <form onSubmit={verify}>
                    <label>
                      {setup ? "验证器中的 6 位验证码" : "验证码或一次性恢复码"}
                      <input name="code" autoComplete="one-time-code" required />
                    </label>
                    {setup && (
                      <label className="check">
                        <input type="checkbox" required />
                        我已妥善保存恢复码
                      </label>
                    )}
                    <button className="button primary" disabled={busy}>
                      {busy ? "验证中…" : "验证并继续"}
                    </button>
                  </form>
                </>
              )}
            </>
          ) : ["LOGIN", "DISABLED"].includes(state) ? (
            <form onSubmit={login}>
              <label>
                账号
                <input name="login" autoComplete="username" required autoFocus />
              </label>
              <label>
                密码
                <input name="password" type="password" autoComplete="current-password" required />
              </label>
              <label className="check">
                <input name="remember" type="checkbox" />
                记住此设备 30 天
              </label>
              <button className="button primary" disabled={busy}>
                {busy ? "登录中…" : "登录"}
              </button>
              <p>忘记密码？请联系系统管理员获取恢复凭据。</p>
              <p>账号由系统管理员开通，不开放注册。</p>
            </form>
          ) : (
            <>
              <p>
                {state === "UNINITIALIZED"
                  ? "请由部署者在终端设置首位系统管理员。完成后刷新本页。"
                  : state === "RECOVERY"
                    ? "部署者正在复核账号与空间权限，通过完整性检查后恢复普通访问。"
                    : state === "CHECKING"
                      ? "请稍候，正在验证当前设备的会话。"
                      : "请检查网络连接后重新读取，不会自动重发已提交操作。"}
              </p>
              <button className="button" disabled={busy} onClick={() => void run(onRetry)}>
                重新检查
              </button>
            </>
          )}
        </section>
        <footer className="auth-bottom">Traqen · 让理解可追溯，让工作能继续。</footer>
      </main>
    </div>
  );
}
