import { PeopleSidebar } from "@/components/SidebarLayout";

export default function PeopleLayout({ children }: { children: React.ReactNode }) {
  return <PeopleSidebar>{children}</PeopleSidebar>;
}
