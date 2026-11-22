import {
  LayoutDashboard, Clapperboard, Bot, CalendarDays, Library, ListOrdered, History, Share2, Building2, Tags, BarChart3, Wallet, Plug, Bell, Settings, PanelsTopLeft,
} from "lucide-react";

export const NAV = [
  { href: "/dashboard", key: "dashboard", icon: LayoutDashboard },\n  { href: "/social", key: "social", icon: PanelsTopLeft },
  { href: "/generate", key: "generate", icon: Clapperboard },
  { href: "/automation", key: "automation", icon: Bot },
  { href: "/calendar", key: "calendar", icon: CalendarDays },
  { href: "/library", key: "library", icon: Library },
  { href: "/queue", key: "queue", icon: ListOrdered },
  { href: "/history", key: "history", icon: History },
  { href: "/accounts", key: "accounts", icon: Share2 },
  { href: "/brands", key: "brands", icon: Building2 },
  { href: "/categories", key: "categories", icon: Tags },
  { href: "/analytics", key: "analytics", icon: BarChart3 },
  { href: "/costs", key: "costs", icon: Wallet },
  { href: "/integrations", key: "integrations", icon: Plug },
  { href: "/notifications", key: "notifications", icon: Bell },
  { href: "/settings", key: "settings", icon: Settings },
] as const;
