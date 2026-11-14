import { NavLink, Route, Routes } from 'react-router'
import { Toaster } from '@/components/ui/sonner'
import { Clapperboard, FolderCog, LayoutGrid, Wand2 } from 'lucide-react'
import Library from './pages/Library'
import Categories from './pages/Categories'
import HotVideo from './pages/HotVideo'
import { cn } from '@/lib/utils'

const NAV = [
  { to: '/hot', label: '爆款复刻', icon: Wand2, end: false },
  { to: '/', label: '素材库', icon: LayoutGrid, end: true },
  { to: '/categories', label: '分类管理', icon: FolderCog, end: false },
]

export default function App() {
  return (
    <div className="min-h-dvh flex bg-background">
      {/* 侧边栏 */}
      <aside className="w-56 shrink-0 border-r border-sidebar-border bg-sidebar-background flex flex-col">
        <div className="h-16 flex items-center gap-2.5 px-5 border-b border-sidebar-border">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Clapperboard className="w-4.5 h-4.5 text-primary-foreground" strokeWidth={2.2} />
          </div>
          <div>
            <div className="text-sm font-semibold text-sidebar-accent-foreground leading-tight">剪映素材库</div>
            <div className="text-[11px] text-muted-foreground leading-tight">自媒体素材管理台</div>
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-2.5 px-3 h-10 rounded-lg text-sm transition-colors',
                  'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  isActive
                    ? 'bg-sidebar-accent text-primary font-medium'
                    : 'text-sidebar-foreground',
                )
              }
            >
              <Icon className="w-4 h-4" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="p-4 border-t border-sidebar-border">
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            二期预告：剪映模板管理 · AI 口播脚本 · 素材自动打标
          </p>
        </div>
      </aside>

      {/* 主区域 */}
      <main className="flex-1 min-w-0">
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="/hot" element={<HotVideo />} />
          <Route path="/categories" element={<Categories />} />
        </Routes>
      </main>

      <Toaster position="top-center" richColors theme="dark" />
    </div>
  )
}
