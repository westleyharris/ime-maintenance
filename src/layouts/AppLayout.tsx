import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import Header from '../components/Header';
import MobileNav from '../components/MobileNav';

export default function AppLayout() {
  return (
    <div className="flex flex-col min-h-screen">
      <Header />
      <div className="flex flex-1 min-h-0">
        {/* Sidebar: hidden on mobile, visible md+ */}
        <Sidebar />
        <main className="flex-1 p-4 md:p-8 overflow-auto bg-page-bg pb-20 md:pb-8">
          <Outlet />
        </main>
      </div>
      {/* Bottom tab bar: mobile only */}
      <MobileNav />
    </div>
  );
}
