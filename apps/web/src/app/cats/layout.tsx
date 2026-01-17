import { CatsSidebar } from "@/components/SidebarLayout";

export default function CatsLayout({ children }: { children: React.ReactNode }) {
  return <CatsSidebar>{children}</CatsSidebar>;
}
