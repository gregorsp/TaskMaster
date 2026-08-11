import { useState } from "react";
import { Outlet, useNavigate, useLocation } from "react-router-dom";
import {
  AppBar,
  Box,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
  Badge,
  Menu,
  MenuItem,
  Avatar,
  Divider,
} from "@mui/material";
import {
  Menu as MenuIcon,
  Dashboard as DashboardIcon,
  CalendarMonth as CalendarIcon,
  EventNote as PlanIcon,
  Today as TodayIcon,
  GridView as MatrixIcon,
  Label as LabelIcon,
  AdminPanelSettings as AdminIcon,
  Person as PersonIcon,
  DarkMode as DarkModeIcon,
  LightMode as LightModeIcon,
} from "@mui/icons-material";
import { useAuth } from "../../context/AuthContext";
import { useThemeMode } from "../../context/ThemeContext";

const DRAWER_WIDTH = 240;

function hashColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i);
    hash |= 0;
  }
  return `hsl(${Math.abs(hash) % 360}, 50%, 40%)`;
}

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
  adminOnly?: boolean;
}

export function AppShell() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [userMenuAnchor, setUserMenuAnchor] = useState<null | HTMLElement>(null);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { mode, toggle: toggleTheme } = useThemeMode();

  const navItems: NavItem[] = [
    { path: "/", label: "Aufgaben", icon: <DashboardIcon /> },
    { path: "/daily", label: "Tagesansicht", icon: <TodayIcon /> },
    { path: "/calendar", label: "Kalender", icon: <CalendarIcon /> },
    { path: "/plan", label: "Planung", icon: <PlanIcon /> },
    { path: "/matrix", label: "Matrix", icon: <MatrixIcon /> },
    { path: "/categories", label: "Kategorien", icon: <LabelIcon /> },
    { path: "/admin", label: "Admin", icon: <AdminIcon />, adminOnly: true },
  ];

  const filteredNav = navItems.filter((item) => !item.adminOnly || user?.isAdmin);

  const drawerContent = (
    <Box sx={{ width: DRAWER_WIDTH }}>
      <Toolbar>
        <Typography variant="h6" fontWeight={700}>
          TaskMaster
        </Typography>
      </Toolbar>
      <Divider />
      <List>
        {filteredNav.map((item) => (
          <ListItemButton
            key={item.path}
            selected={location.pathname === item.path}
            onClick={() => {
              navigate(item.path);
              if (isMobile) setDrawerOpen(false);
            }}
          >
            <ListItemIcon>{item.icon}</ListItemIcon>
            <ListItemText primary={item.label} />
            {item.badge ? (
              <Badge badgeContent={item.badge} color="error" sx={{ mr: 1 }} />
            ) : null}
          </ListItemButton>
        ))}
      </List>
    </Box>
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100vh" }}>
      <AppBar position="fixed" sx={{ zIndex: theme.zIndex.drawer + 1 }}>
        <Toolbar>
          {isMobile && (
            <IconButton color="inherit" edge="start" onClick={() => setDrawerOpen(true)} sx={{ mr: 2 }}>
              <MenuIcon />
            </IconButton>
          )}
          <Typography variant="h6" fontWeight={700} sx={{ flexGrow: 1 }}>
            TaskMaster
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <IconButton color="inherit" onClick={toggleTheme} title={mode === "dark" ? "Helles Design" : "Dunkles Design"}>
              {mode === "dark" ? <LightModeIcon /> : <DarkModeIcon />}
            </IconButton>
            <Typography variant="body2">{user?.displayName}</Typography>
            <IconButton color="inherit" onClick={(e) => setUserMenuAnchor(e.currentTarget)}>
              <Avatar
                src={user?.profilePicture ?? undefined}
                sx={{ width: 32, height: 32, fontSize: 14, bgcolor: user ? hashColor(user.id) : "secondary.main" }}
              >
                {user?.displayName?.charAt(0)?.toUpperCase()}
              </Avatar>
            </IconButton>
          </Box>
          <Menu
            anchorEl={userMenuAnchor}
            open={!!userMenuAnchor}
            onClose={() => setUserMenuAnchor(null)}
          >
            <MenuItem disabled dense>
              {user?.email}
            </MenuItem>
            <Divider />
            <MenuItem
              onClick={() => {
                setUserMenuAnchor(null);
                navigate("/profile");
              }}
            >
              <PersonIcon sx={{ mr: 1, fontSize: 20 }} />
              Profil
            </MenuItem>
            <Divider />
            <MenuItem
              onClick={async () => {
                setUserMenuAnchor(null);
                await logout();
                navigate("/login");
              }}
            >
              Abmelden
            </MenuItem>
          </Menu>
        </Toolbar>
      </AppBar>

      {isMobile ? (
        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
          {drawerContent}
        </Drawer>
      ) : (
        <Drawer variant="permanent" open>
          {drawerContent}
        </Drawer>
      )}

      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          pt: 8,
          pl: isMobile ? 0 : `${DRAWER_WIDTH}px`,
          minHeight: "100vh",
          bgcolor: "background.default",
        }}
      >
        <Box sx={{ p: 3 }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
