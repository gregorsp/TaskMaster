import { useState, useEffect } from "react";
import {
  Box, Typography, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Paper, IconButton, Switch, Chip, Avatar,
} from "@mui/material";
import { Delete as DeleteIcon } from "@mui/icons-material";
import { listUsers, updateUser, deleteUser, type User } from "../api/usersApi";
import { useNotify } from "../context/NotifyContext";

function hashColor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i);
    hash |= 0;
  }
  return `hsl(${Math.abs(hash) % 360}, 50%, 40%)`;
}

export function AdminPage() {
  const [users, setUsers] = useState<User[]>([]);
  const notify = useNotify();

  const load = async () => {
    const data = await listUsers();
    setUsers(data);
  };

  useEffect(() => { load(); }, []);

  const handleToggleAdmin = async (user: User) => {
    try {
      await updateUser(user.id, { isAdmin: !user.isAdmin });
      setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, isAdmin: !u.isAdmin } : u));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      notify(msg || "Fehler beim Ändern der Admin-Rolle", "error");
    }
  };

  const handleDelete = async (user: User) => {
    if (!window.confirm("Nutzer wirklich löschen?")) return;
    try {
      await deleteUser(user.id);
      setUsers((prev) => prev.filter((u) => u.id !== user.id));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      notify(msg || "Fehler beim Löschen", "error");
    }
  };

  return (
    <Box>
      <Typography variant="h4" mb={2}>Administration</Typography>

      <TableContainer component={Paper}>
        <Table sx={{ tableLayout: "fixed" }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: "30%" }}>Name</TableCell>
              <TableCell sx={{ width: "25%" }}>E-Mail</TableCell>
              <TableCell sx={{ width: "15%" }}>Rolle</TableCell>
              <TableCell sx={{ width: "15%" }}>Bild</TableCell>
              <TableCell align="right" sx={{ width: "15%" }}>Aktionen</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell sx={{ overflowWrap: "anywhere" }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Avatar
                      src={user.profilePicture ?? undefined}
                      sx={{ width: 32, height: 32, fontSize: 14, bgcolor: hashColor(user.id) }}
                    >
                      {user.displayName?.charAt(0)?.toUpperCase()}
                    </Avatar>
                    <Box>
                      <Typography fontWeight={500}>{user.displayName}</Typography>
                      <Typography variant="caption" color="text.secondary">@{user.username}</Typography>
                    </Box>
                  </Box>
                </TableCell>
                <TableCell sx={{ overflowWrap: "anywhere" }}>{user.email}</TableCell>
                <TableCell>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Chip size="small" label={user.isAdmin ? "Admin" : "Nutzer"} color={user.isAdmin ? "primary" : "default"} />
                    <Switch size="small" checked={user.isAdmin} onChange={() => handleToggleAdmin(user)} />
                  </Box>
                </TableCell>
                <TableCell>
                  <Avatar
                    src={user.profilePicture ?? undefined}
                    sx={{ width: 40, height: 40, fontSize: 18, bgcolor: hashColor(user.id) }}
                  >
                    {user.displayName?.charAt(0)?.toUpperCase()}
                  </Avatar>
                </TableCell>
                <TableCell align="right">
                  <IconButton size="small" color="error" onClick={() => handleDelete(user)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  );
}
