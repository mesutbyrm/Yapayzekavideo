"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export const PLATFORM_COLORS: Record<string, string> = { INSTAGRAM: "#ec4899", FACEBOOK: "#3b82f6", TIKTOK: "#14b8a6", YOUTUBE: "#ef4444" };
const axis = { stroke: "currentColor", fontSize: 11, tickLine: false, axisLine: false } as const;
const tooltipStyle = { contentStyle: { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12, backdropFilter: "blur(12px)" } };

export function SeriesArea({ data, dataKey = "value", color = "#8b5cf6", height = 220, valueFormat }: { data: { label: string; [k: string]: any }[]; dataKey?: string; color?: string; height?: number; valueFormat?: "usd" }) {
  const id = `g-${dataKey}-${color.replace("#", "")}`;
  return (
    <div className="text-muted-foreground" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ left: -18, right: 8, top: 8 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeOpacity={0.08} vertical={false} />
          <XAxis dataKey="label" {...axis} />
          <YAxis {...axis} allowDecimals={valueFormat === "usd"} />
          <Tooltip {...tooltipStyle} formatter={(v: any) => (valueFormat === "usd" ? `$${Number(v).toFixed(4)}` : v)} />
          <Area type="monotone" name={valueFormat === "usd" ? "Maliyet" : "Video"} dataKey={dataKey} stroke={color} strokeWidth={2} fill={`url(#${id})`} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function SimpleBars({ data, dataKey = "value", color = "#38bdf8", height = 220 }: { data: { label: string; [k: string]: any }[]; dataKey?: string; color?: string; height?: number }) {
  return (
    <div className="text-muted-foreground" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ left: -18, right: 8, top: 8 }}>
          <CartesianGrid strokeOpacity={0.08} vertical={false} />
          <XAxis dataKey="label" {...axis} />
          <YAxis {...axis} />
          <Tooltip {...tooltipStyle} cursor={{ fillOpacity: 0.05 }} />
          <Bar dataKey={dataKey} name="Video" fill={color} radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function PlatformBars({ data, keys, height = 240 }: { data: { platform: string; [k: string]: any }[]; keys: { key: string; label: string; color: string }[]; height?: number }) {
  const rows = data.map((d) => ({ ...d, label: d.platform.charAt(0) + d.platform.slice(1).toLowerCase() }));
  return (
    <div className="text-muted-foreground" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ left: -10, right: 8, top: 8 }}>
          <CartesianGrid strokeOpacity={0.08} vertical={false} />
          <XAxis dataKey="label" {...axis} />
          <YAxis {...axis} />
          <Tooltip {...tooltipStyle} cursor={{ fillOpacity: 0.05 }} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {keys.map((k) => (
            <Bar key={k.key} dataKey={k.key} name={k.label} fill={k.color} radius={[6, 6, 0, 0]} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
