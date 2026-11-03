import { createHashRouter, Navigate } from 'react-router'
import { HistoryPage } from '../pages/history/HistoryPage'
import { HomePage } from '../pages/home/HomePage'
import { OnboardingPage } from '../pages/onboarding/OnboardingPage'
import { SessionPage } from '../pages/session/SessionPage'
import { SettingsPage } from '../pages/settings/SettingsPage'
import { Layout } from '../shell/Layout'

// 路由（phase1-implementation 6.1 节）。用 hash 路由：页面从 file:// 加载，设置分区也能直达。
export const router = createHashRouter([
  { path: '/onboarding', element: <OnboardingPage /> },
  {
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 's/:id', element: <SessionPage /> },
      { path: 'history', element: <HistoryPage /> },
      { path: 'settings', element: <Navigate to="/settings/general" replace /> },
      { path: 'settings/:section', element: <SettingsPage /> },
    ],
  },
])
