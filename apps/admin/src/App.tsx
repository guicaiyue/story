import { ConfigProvider, App as AntApp } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { tokens } from './theme';
import { AppLayout } from './components/AppLayout';
import { LoginPage } from './pages/LoginPage';
import { DashboardPage } from './pages/DashboardPage';
import { StoriesPage } from './pages/StoriesPage';
import { StoryEditPage } from './pages/StoryEditPage';
import { ReviewPage } from './pages/ReviewPage';
import { OpsPage } from './pages/OpsPage';
import { FamiliesPage } from './pages/FamiliesPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { SystemPage } from './pages/SystemPage';

/** Ant Design 主题，数值取自设计稿 tokens.css。 */
const antTheme = {
  token: {
    colorPrimary: tokens.brand,
    colorInfo: tokens.teal,
    colorSuccess: tokens.ok,
    colorWarning: tokens.warn,
    colorError: tokens.danger,
    colorTextBase: tokens.ink,
    colorBgBase: tokens.bg,
    colorBgContainer: tokens.surface,
    colorBorder: tokens.line,
    colorBorderSecondary: tokens.line,
    borderRadius: tokens.radiusSm,
    borderRadiusLG: tokens.radius,
    fontFamily:
      "'MiSans','PingFang SC','HarmonyOS Sans SC','Noto Sans CJK SC','Microsoft YaHei',system-ui,-apple-system,sans-serif",
    fontSize: 14,
  },
  components: {
    Layout: { bodyBg: tokens.bg, headerBg: tokens.surface, siderBg: tokens.sidebarBg },
    Card: { borderRadiusLG: tokens.radiusLg },
    Table: { headerBg: tokens.surface2, rowHoverBg: tokens.surface2, borderColor: tokens.line },
    Button: { primaryShadow: 'none' },
    Menu: { itemBorderRadius: tokens.radiusSm },
  },
};

function RequireAuth({ children }: { children: React.ReactElement }) {
  const { isAuthed } = useAuth();
  if (!isAuthed) return <Navigate to="/login" replace />;
  return children;
}

function Router() {
  const { isAuthed } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={isAuthed ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <AppLayout />
          </RequireAuth>
        }
      >
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/stories" element={<StoriesPage />} />
        <Route path="/stories/:id" element={<StoryEditPage />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/ops" element={<OpsPage />} />
        <Route path="/families" element={<FamiliesPage />} />
        <Route path="/analytics" element={<AnalyticsPage />} />
        <Route path="/system" element={<SystemPage />} />
      </Route>
      <Route path="*" element={<Navigate to={isAuthed ? '/dashboard' : '/login'} replace />} />
    </Routes>
  );
}

export function App() {
  return (
    <ConfigProvider locale={zhCN} theme={antTheme}>
      <AntApp>
        <AuthProvider>
          <Router />
        </AuthProvider>
      </AntApp>
    </ConfigProvider>
  );
}
