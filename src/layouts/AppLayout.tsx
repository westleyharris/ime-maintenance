import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import Header from '../components/Header';

export default function AppLayout() {
  return (
    <div className="flex flex-col min-h-screen">
      {/* Header spans full width */}
      <Header />
      <div className="flex flex-1">
        <Sidebar />
        <main className="flex-1 p-8 overflow-auto bg-page-bg">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
