import { useEffect, useState } from "react";
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
  ListSubheader,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
  Badge,
  Menu,
  MenuItem,
  Avatar,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Tooltip,
} from "@mui/material";
import {
  Menu as MenuIcon,
  Dashboard as DashboardIcon,
  CalendarMonth as CalendarIcon,
  EventNote as PlanIcon,
  Today as TodayIcon,
  GridView as MatrixIcon,
  Label as LabelIcon,
  LocalOffer as ContextIcon,
  Settings as SettingsIcon,
  Lightbulb as LightbulbIcon,
  CheckCircleOutline as GtdIcon,
  AdminPanelSettings as AdminIcon,
  Person as PersonIcon,
  Audiotrack as AudioIcon,
  Insights as StatsIcon,
  GraphicEq as NotesIcon,
  SelfImprovement as MeditationIcon,
  DarkMode as DarkModeIcon,
  LightMode as LightModeIcon,
  Flag as GoalIcon,
  Schedule as BlocksIcon,
  MoveToInbox as CaptureIcon,
} from "@mui/icons-material";
import { useAuth } from "../../context/AuthContext";
import { useThemeMode } from "../../context/ThemeContext";
import { TranscriptionIndicator } from "../transcription/TranscriptionIndicator";
import { startTranscriptionRunner, stopTranscriptionRunner } from "../../asr/runner";
import { QuickCapture } from "../tasks/QuickCapture";

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
  /** Unterpunkte, eingerückt unter dem Eintrag (z. B. GTD → Ziele, Zeitblöcke). */
  children?: NavItem[];
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
  const [captureOpen, setCaptureOpen] = useState(false);
  const [capturedCount, setCapturedCount] = useState(0);

  useEffect(() => {
    startTranscriptionRunner();
    return () => stopTranscriptionRunner();
  }, []);

  const navItems: NavItem[] = [
    { path: "/", label: "Aufgaben", icon: <DashboardIcon /> },
    { path: "/daily", label: "Tagesansicht", icon: <TodayIcon /> },
    { path: "/notes", label: "Notizen", icon: <NotesIcon /> },
    { path: "/meditation", label: "Meditation", icon: <MeditationIcon /> },
    { path: "/calendar", label: "Kalender", icon: <CalendarIcon /> },
    { path: "/plan", label: "Planung", icon: <PlanIcon /> },
    { path: "/matrix", label: "Matrix", icon: <MatrixIcon /> },
    { path: "/categories", label: "Kategorien", icon: <LabelIcon /> },
    { path: "/contexts", label: "Kontexte", icon: <ContextIcon /> },
    { path: "/brainstorming", label: "Brainstorming", icon: <LightbulbIcon /> },
    {
      path: "/gtd", label: "GTD", icon: <GtdIcon />,
      children: [
        { path: "/gtd/goals", label: "Ziele", icon: <GoalIcon fontSize="small" /> },
        { path: "/gtd/blocks", label: "Zeitblöcke", icon: <BlocksIcon fontSize="small" /> },
      ],
    },
  ];

  const go = (path: string) => {
    navigate(path);
    if (isMobile) setDrawerOpen(false);
  };

  const renderNavItem = (item: NavItem, nested = false) => (
    <ListItemButton
      key={item.path}
      sx={nested ? { pl: 4, py: 0.5 } : undefined}
      selected={
        item.path === "/"
          ? location.pathname === "/" || location.pathname.startsWith("/t/")
          : location.pathname === item.path
      }
      onClick={() => go(item.path)}
    >
      <ListItemIcon sx={nested ? { minWidth: 36 } : undefined}>{item.icon}</ListItemIcon>
      <ListItemText primary={item.label} primaryTypographyProps={nested ? { variant: "body2" } : undefined} />
      {item.badge ? <Badge badgeContent={item.badge} color="error" sx={{ mr: 1 }} /> : null}
    </ListItemButton>
  );

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
        {filteredNav.flatMap((item) => [
          renderNavItem(item),
          ...(item.children ?? []).map((child) => renderNavItem(child, true)),
        ])}
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
            <TranscriptionIndicator />
            <Tooltip title="Gedanken erfassen (Eingangskorb)">
              <IconButton color="inherit" onClick={() => { setCapturedCount(0); setCaptureOpen(true); }}>
                <CaptureIcon />
              </IconButton>
            </Tooltip>
            <IconButton color="inherit" onClick={toggleTheme} title={mode === "dark" ? "Helles Design" : "Dunkles Design"}>
              {mode === "dark" ? <LightModeIcon /> : <DarkModeIcon />}
            </IconButton>
            <Typography variant="body2" sx={{ display: { xs: "none", sm: "block" } }}>{user?.displayName}</Typography>
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
            <ListSubheader sx={{ lineHeight: "28px", bgcolor: "transparent" }}>Verwaltung</ListSubheader>
            <MenuItem
              onClick={() => {
                setUserMenuAnchor(null);
                navigate("/profile");
              }}
            >
              <PersonIcon sx={{ mr: 1, fontSize: 20 }} />
              Profil
            </MenuItem>
            <MenuItem
              onClick={() => {
                setUserMenuAnchor(null);
                navigate("/settings");
              }}
            >
              <SettingsIcon sx={{ mr: 1, fontSize: 20 }} />
              Einstellungen
            </MenuItem>
            <MenuItem
              onClick={() => {
                setUserMenuAnchor(null);
                navigate("/audio");
              }}
            >
              <AudioIcon sx={{ mr: 1, fontSize: 20 }} />
              Audio
            </MenuItem>
            <MenuItem
              onClick={() => {
                setUserMenuAnchor(null);
                navigate("/stats");
              }}
            >
              <StatsIcon sx={{ mr: 1, fontSize: 20 }} />
              Statistik
            </MenuItem>
            {user?.isAdmin && (
              <MenuItem
                onClick={() => {
                  setUserMenuAnchor(null);
                  navigate("/admin");
                }}
              >
                <AdminIcon sx={{ mr: 1, fontSize: 20 }} />
                Admin
              </MenuItem>
            )}
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
        <Box sx={{ p: { xs: 2, sm: 3 } }}>
          <Outlet />
        </Box>
      </Box>

      <Dialog open={captureOpen} onClose={() => setCaptureOpen(false)} fullWidth maxWidth="sm"
        sx={{ "& .MuiDialog-container": { alignItems: "flex-start" } }}>
        <DialogTitle>Gedanken erfassen</DialogTitle>
        <DialogContent>
          <Box pt={1}>
            <QuickCapture autoFocus onCaptured={() => setCapturedCount((n) => n + 1)} />
          </Box>
          <Typography variant="body2" color="text.secondary" mt={1.5}>
            {capturedCount > 0
              ? `${capturedCount} Gedanke(n) im Eingangskorb – geklärt wird später.`
              : "Einfach tippen und Enter – mehrere hintereinander gehen auch."}
          </Typography>
        </DialogContent>
        <DialogActions>
          {capturedCount > 0 && (
            <Button onClick={() => { setCaptureOpen(false); navigate("/gtd?tab=inbox"); }}>Zum Eingangskorb</Button>
          )}
          <Button onClick={() => setCaptureOpen(false)}>Fertig</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
