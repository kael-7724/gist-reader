"use client";

import { useState, type FormEvent } from "react";
import { KeyRound, Loader2, LogOut, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export function AccountDialog() {
  const [open, setOpen] = useState(false);
  const [username, setUsername] = useState("");
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setCurrent("");
    setNext("");
    setAgain("");
    setError("");
  }

  async function onOpenChange(value: boolean) {
    setOpen(value);
    reset();
    if (value && !username) {
      const response = await fetch("/account").catch(() => null);
      const data = response?.ok ? await response.json() as { username?: string } : null;
      if (data?.username) setUsername(data.username);
    }
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
      setOpen(false);
      reset();
    } catch {
      setError("网络出错了，再试一次");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => void onOpenChange(value)}>
      <DialogTrigger asChild>
        <Button variant="outline" className="rounded-xl" aria-label="账户" title="账户"><UserRound className="size-4" /></Button>
      </DialogTrigger>
      <DialogContent className="rounded-xl sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-2xl">{username || "账户"}</DialogTitle>
          <DialogDescription className="sr-only">修改密码或退出登录</DialogDescription>
        </DialogHeader>
        <form className="grid gap-3" noValidate onSubmit={(event) => void submit(event)}>
          <Input type="password" autoComplete="current-password" placeholder="当前密码" aria-label="当前密码" value={current} onChange={(event) => setCurrent(event.target.value)} className="h-11 rounded-xl" required />
          <Input type="password" autoComplete="new-password" placeholder="新密码（至少 8 位）" aria-label="新密码" value={next} onChange={(event) => setNext(event.target.value)} className="h-11 rounded-xl" required minLength={8} />
          <Input type="password" autoComplete="new-password" placeholder="再输一次新密码" aria-label="再输一次新密码" value={again} onChange={(event) => setAgain(event.target.value)} className="h-11 rounded-xl" required />
          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          <Button type="submit" className="h-11 rounded-xl" disabled={saving || !current || !next || !again}>{saving ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}修改密码</Button>
        </form>
        <a href="/logout" className="inline-flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground"><LogOut className="size-4" />退出登录</a>
      </DialogContent>
    </Dialog>
  );
}
