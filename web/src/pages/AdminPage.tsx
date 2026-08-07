import { useState, useEffect } from "react";
import {
  Box, Typography, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Paper, IconButton, Switch, Chip,
} from "@mui/material";
import { Delete as DeleteIcon } from "@mui/icons-material";
import { listUsers, updateUser, deleteUser, type User } from "../api/usersApi";

export function AdminPage() {
  const [users, setUsers] = useState<User[]>([]);

  const load = async () => {
    const data = await listUsers();
    setUsers(data);
  };

  useEffect(() => { load(); }, []);

  const handleToggleAdmin = async (user: User) => {
    await updateUser(user.id, { isAdmin: !user.isAdmin });
    setUsers((prev) => prev.map((u) => u.id === user.id ? { ...u, isAdmin: !u.isAdmin } : u));
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Nutzer wirklich löschen?")) return;
    await deleteUser(id);
    setUsers((prev) => prev.filter((u) => u.id !== id));
  };

  return (
    <Box>
      <Typography variant="h4" mb={2}>Administration</Typography>

      <TableContainer component={Paper}>
        <Table sx={{ tableLayout: "fixed" }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: "35%" }}>Name</TableCell>
              <TableCell sx={{ width: "30%" }}>E-Mail</TableCell>
              <TableCell sx={{ width: "20%" }}>Rolle</TableCell>
              <TableCell align="right" sx={{ width: "15%" }}>Aktionen</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell sx={{ overflowWrap: "anywhere" }}>
                  <Typography fontWeight={500}>{user.displayName}</Typography>
                  <Typography variant="caption" color="text.secondary">@{user.username}</Typography>
                </TableCell>
                <TableCell sx={{ overflowWrap: "anywhere" }}>{user.email}</TableCell>
                <TableCell>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <Chip size="small" label={user.isAdmin ? "Admin" : "Nutzer"} color={user.isAdmin ? "primary" : "default"} />
                    <Switch size="small" checked={user.isAdmin} onChange={() => handleToggleAdmin(user)} />
                  </Box>
                </TableCell>
                <TableCell align="right">
                  <IconButton size="small" color="error" onClick={() => handleDelete(user.id)}>
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
