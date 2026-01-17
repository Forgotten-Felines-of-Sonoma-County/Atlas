import { PlacesSidebar } from "@/components/SidebarLayout";

export default function PlacesLayout({ children }: { children: React.ReactNode }) {
  return <PlacesSidebar>{children}</PlacesSidebar>;
}
