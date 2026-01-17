import { RequestsSidebar } from "@/components/SidebarLayout";

export default function RequestsLayout({ children }: { children: React.ReactNode }) {
  return <RequestsSidebar>{children}</RequestsSidebar>;
}
