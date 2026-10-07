import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './pages/AppShell'
import { AtriumPage } from './pages/AtriumPage'
import { ChatDetailPage } from './pages/ChatDetailPage'
import { ChatsPage } from './pages/ChatsPage'
import { DashboardPage } from './pages/DashboardPage'
import { GroupsPage } from './pages/GroupsPage'
import { LeadsPage } from './pages/LeadsPage'
import { RequestsPage } from './pages/RequestsPage'
import { SupportPage } from './pages/SupportPage'
import { UnlockPage } from './pages/UnlockPage'
import { BrandPage } from './pages/BrandPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/unlock" element={<UnlockPage />} />
        <Route element={<AppShell />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/chats" element={<ChatsPage />} />
          <Route path="/chats/:chatId" element={<ChatDetailPage />} />
          <Route path="/groups" element={<GroupsPage />} />
          <Route path="/support" element={<SupportPage />} />
          <Route path="/requests" element={<RequestsPage />} />
          <Route path="/leads" element={<LeadsPage />} />
          <Route path="/atrium" element={<AtriumPage />} />
          <Route path="/brand" element={<BrandPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
