import { IntakeSidebar } from "@/components/SidebarLayout";

export default function IntakeLayout({ children }: { children: React.ReactNode }) {
  return <IntakeSidebar>{children}</IntakeSidebar>;
}
