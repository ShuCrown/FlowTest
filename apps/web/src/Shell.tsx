import { NavLink, Outlet } from "react-router-dom";
import { Toasts } from "./components/ui.js";

const NAV = [
  { to: "/", label: "流程", code: "FLW", end: true },
  { to: "/systems", label: "系统", code: "SYS" },
  { to: "/runs", label: "运行", code: "RUN" },
  { to: "/recordings", label: "采集", code: "REC" },
  { to: "/settings", label: "设置", code: "CFG" },
];

export function Shell() {
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-[86px] shrink-0 flex-col border-r border-forge-700 bg-forge-950/90 backdrop-blur">
        <div className="flex h-[86px] flex-col items-center justify-center border-b border-forge-700">
          <div className="h-3 w-3 rotate-45 border border-ember-500 bg-ember-500/20" />
          <div className="mt-2 font-mono text-[9px] uppercase tracking-[0.22em] text-ember-500">
            forge
          </div>
        </div>
        <nav className="flex flex-1 flex-col gap-1 py-4">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `group relative flex flex-col items-center gap-1 py-3 transition-colors ${
                  isActive ? "text-ember-400" : "text-forge-400 hover:text-paper"
                }`
              }
            >
              {({ isActive }) => (
                <>
                  {isActive ? (
                    <span className="absolute left-0 top-1/2 h-7 w-[2px] -translate-y-1/2 bg-ember-500" />
                  ) : null}
                  <span className="font-mono text-[10px] tracking-[0.18em]">{item.code}</span>
                  <span className="text-[11px]">{item.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-forge-700 px-2 py-4 text-center">
          <div className="font-mono text-[9px] uppercase tracking-[0.16em] text-forge-400">
            v0.1
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-6 py-6 lg:px-10">
        <Outlet />
      </main>
      <Toasts />
    </div>
  );
}
