"use client";

import {
  Bookmark,
  BriefcaseBusiness,
  CircleUserRound,
  Globe2,
  LayoutDashboard,
  Radar,
  Search,
  Settings2,
} from "lucide-react";
import type { View } from "../workspaceUrl";

export type NavItem = {
  id: View;
  label: string;
  icon: typeof Radar;
};

export const NAV_ITEMS: Array<NavItem> = [
  { id: "home", label: "Home", icon: LayoutDashboard },
  { id: "discover", label: "Discover", icon: Radar },
  { id: "searches", label: "Searches", icon: Search },
  { id: "saved", label: "Saved", icon: Bookmark },
  { id: "applications", label: "Applications", icon: BriefcaseBusiness },
  { id: "profile", label: "Profile", icon: CircleUserRound },
  { id: "sources", label: "Sources", icon: Globe2 },
  { id: "settings", label: "Settings", icon: Settings2 },
];
