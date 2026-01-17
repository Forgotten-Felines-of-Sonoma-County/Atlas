import { MainSidebar } from "@/components/SidebarLayout";

export default function SearchLayout({ children }: { children: React.ReactNode }) {
  return <MainSidebar>{children}</MainSidebar>;
}
