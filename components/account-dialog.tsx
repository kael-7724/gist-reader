"use client";

import { useEffect, useState, type FormEvent } from "react";
import { KeyRound, Loader2, LogOut, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AccountSection() {
  const [username, setUsername] = useState("");
  const [editing, setEditing] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/account").then((response) => response.ok ? response.json() as Promise<{ username?: string }> : null).then((data) => { if (alive && data?.username) setUsername(data.username); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  function reset() {
    setCurrent("");
    setNext("");
    setAgain("");
    setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (next.length < 8) { setError("新密码至少 8 位"); return; }
    if (next !== again) { setError("两次输入的新密码不一样"); return; }
    setSaving(true);
    try {
      const response = await fetch("/account/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ current, next }) });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) { setError(data.error || "修改失败"); return; }
      toast.success("密码已修改，其他设备需要重新登录");
      setEditing(false);
      reset();
    } catch {
      setError("网络出错了，再试一次");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="settings-section">
      <h3><UserRound className="size-4" />{username || "账户"}</h3>
      {editing ? (
        <form className="grid gap-3" noValidate onSubmit={(event) => void submit(event)}>
          <Input type="password" autoComplete="current-password" placeholder="当前密码" aria-label="当前密码" value={current} onChange={(event) => setCurrent(event.target.value)} className="h-11 rounded-xl" autoFocus />
          <Input type="password" autoComplete="new-password" placeholder="新密码（至少 8 位）" aria-label="新密码" value={next} onChange={(event) => setNext(event.target.value)} className="h-11 rounded-xl" />
          <Input type="password" autoComplete="new-password" placeholder="再输一次新密码" aria-label="再输一次新密码" value={again} onChange={(event) => setAgain(event.target.value)} className="h-11 rounded-xl" />
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" className="h-11 rounded-xl" onClick={() => { setEditing(false); reset(); }}>取消</Button>
            <Button type="submit" className="h-11 rounded-xl" disabled={saving || !current || !next || !again}>{saving && <Loader2 className="size-4 animate-spin" />}保存</Button>
          </div>
        </form>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-11 rounded-xl" onClick={() => setEditing(true)}><KeyRound className="size-4" />修改密码</Button>
          <Button variant="outline" className="h-11 rounded-xl" asChild><a href="/logout"><LogOut className="size-4" />退出登录</a></Button>
        </div>
      )}
    </section>
  );
}
