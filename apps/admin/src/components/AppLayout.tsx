import { useCallback, useEffect, useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import {
  BarChartOutlined,
  BookOutlined,
  DashboardOutlined,
  HomeOutlined,
  LogoutOutlined,
  PictureOutlined,
  SettingOutlined,
  TeamOutlined,
  AuditOutlined,
} from '@ant-design/icons';
import { Avatar, Badge, Button, Tooltip } from 'antd';
import { useAuth } from '../auth';
import { api } from '../api/client';
import { tokens } from '../theme';

type NavItem = { to: string; label: string; icon: React.ReactNode; badge?: number };

/**
 * 应用骨架：左侧导航 + 顶栏 + 内容区。
 *
 * 结构对齐设计稿（分「内容运营 / 运营配置 / 用户 / 数据分析 / 系统」五组），
 * 待审数量来自真实的 /api/admin/dashboard。
 */
export function AppLayout() {
  const { account, logout } = useAuth();
  const location = useLocation();
  const [reviewCount, setReviewCount] = useState<number>(0);

  const loadBadge = useCallback(() => {
    api
      .dashboard()
      .then((d) => setReviewCount(d.content.review))
      .catch(() => setReviewCount(0));
  }, []);

  useEffect(() => {
    loadBadge();
  }, [loadBadge, location.pathname]);

  const groups: Array<{ label: string; items: NavItem[] }> = [
    {
      label: '内容运营',
      items: [
        { to: '/dashboard', label: '数据看板', icon: <DashboardOutlined /> },
        { to: '/stories', label: '故事列表', icon: <BookOutlined /> },
        { to: '/review', label: '审核队列', icon: <AuditOutlined />, badge: reviewCount },
      ],
    },
    {
      label: '运营配置',
      items: [{ to: '/ops', label: '分类与推荐位', icon: <PictureOutlined /> }],
    },
    {
      label: '用户',
      items: [{ to: '/families', label: '家庭与儿童档案', icon: <TeamOutlined /> }],
    },
    {
      label: '数据分析',
      items: [{ to: '/analytics', label: '数据中心', icon: <BarChartOutlined /> }],
    },
    {
      label: '系统',
      items: [{ to: '/system', label: '管理员与日志', icon: <SettingOutlined /> }],
    },
  ];

  const current = groups.flatMap((g) => g.items).find((i) => location.pathname.startsWith(i.to));

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v18H6.5A2.5 2.5 0 0 1 4 18.5v-13Z" stroke="#3F5B57" strokeWidth="1.6" />
            <path d="M8 3v18" stroke="#D98E5A" strokeWidth="1.6" />
            <path d="M12 8h4M12 12h4" stroke="#3A3330" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          <span>小故事铺</span>
        </div>

        <nav className="sidebar-nav">
          {groups.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-group-label">{group.label}</div>
              {group.items.map((item) => {
                const active = location.pathname.startsWith(item.to);
                return (
                  <Link key={item.to} to={item.to} className={`nav-item${active ? ' active' : ''}`} data-testid={`nav-${item.to.slice(1)}`}>
                    <span className="nav-item-label">
                      {item.icon}
                      {item.label}
                    </span>
                    {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          v0.1 内测版 · 内容 {2197} 篇
          <br />
          音频全部走 TTS 实时合成
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-crumbs">
            <HomeOutlined /> <span className="sep">/</span>
            <span className="current">{current?.label ?? '工作台'}</span>
          </div>
          <div className="topbar-right">
            <Badge status="processing" text="TTS 队列 · 实时合成" />
            <Tooltip title={account?.phone ?? ''}>
              <Avatar style={{ background: tokens.brand }}>{(account?.nickname ?? 'A').slice(0, 1)}</Avatar>
            </Tooltip>
            <span style={{ fontSize: 13, color: 'var(--ink-2)' }}>
              {account?.role === 'admin' ? '超级管理员' : '编辑'}
            </span>
            <Button size="small" icon={<LogoutOutlined />} onClick={logout}>
              退出
            </Button>
          </div>
        </header>

        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
