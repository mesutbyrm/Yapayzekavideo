"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { useTheme } from "next-themes";
import { Bell, LogOut, Menu, Moon, Sparkles, Sun, X } from "lucide-react";
import { NAV } from "./nav";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { apiFetch } from "@/lib/client";

interface Props {
  user: { name: string; email: string; role: string; locale: string };
  brands: { id: string; name: string; primaryColor: string }[];
  brandId: string | null;
  unread: number;
  children: React.ReactNode;
}

export function AppShell({ user, brands, brandId, unread, children }: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const labels = t(user.locale).nav;

  async function selectBrand(id: string) {
    await apiFetch("/api/brands/select", { method: "POST", json: { brandId: id } });
    router.refresh();
  }
  async function logout() {
    await apiFetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    router.push("/login");
  }

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-3">
      <Link href="/dashboard" className="mb-4 flex items-center gap-2 px-2 py-1">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-primary to-accent text-white shadow-lg shadow-primary/30">
          <Sparkles className="h-4 w-4" />
        </span>
        <span className="text-sm font-semibold tracking-tight">AI Social Factory</span>
      </Link>
      {NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setOpen(false)}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              active ? "bg-primary/12 text-primary font-medium" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="truncate">{labels[item.key]}</span>
            {item.key === "notifications" && unread > 0 ? <span className="ml-auto rounded-full bg-danger px-1.5 text-[10px] font-semibold text-white">{unread}</span> : null}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="flex min-h-dvh">
      <aside className="glass sticky top-0 hidden h-dvh w-64 shrink-0 overflow-y-auto border-y-0 border-l-0 lg:block">{sidebar}</aside>
      {open ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="glass absolute left-0 top-0 h-full w-72 overflow-y-auto bg-background">{sidebar}</aside>
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="glass sticky top-0 z-30 flex h-14 items-center gap-2 border-x-0 border-t-0 px-3 sm:px-5">
          <button aria-label="Menü" className="rounded-lg p-2 hover:bg-muted lg:hidden" onClick={() => setOpen((o) => !o)}>
            {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
          {brands.length ? (
            <select
              aria-label="Marka seç"
              value={brandId ?? ""}
              onChange={(e) => selectBrand(e.target.value)}
              className="h-9 max-w-[50vw] rounded-lg border border-border bg-background/60 px-2 text-sm"
            >
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          ) : null}
          <div className="ml-auto flex items-center gap-1">
            <button aria-label="Tema" className="rounded-lg p-2 hover:bg-muted" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
              <Sun className="hidden h-4 w-4 dark:block" />
              <Moon className="h-4 w-4 dark:hidden" />
            </button>
            <Link aria-label="Bildirimler" href="/notifications" className="relative rounded-lg p-2 hover:bg-muted">
              <Bell className="h-4 w-4" />
              {unread > 0 ? <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-danger" /> : null}
            </Link>
            <div className="hidden px-2 text-right sm:block">
              <div className="text-xs font-medium leading-tight">{user.name}</div>
              <div className="text-[10px] text-muted-foreground">{user.role === "ADMIN" ? "Yönetici" : "Kullanıcı"}</div>
            </div>
            <button aria-label="Çıkış" className="rounded-lg p-2 hover:bg-muted" onClick={logout}>
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
