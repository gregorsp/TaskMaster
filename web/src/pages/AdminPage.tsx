import { useState, useEffect } from "react";
import {
  Box, Typography, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, Paper, IconButton, Switch, Chip, Alert, Button, Stack,
} from "@mui/material";
import { Delete as DeleteIcon } from "@mui/icons-material";
import {
  listUsers,
  updateUser,
  deleteUser,
  getDbMigrationStatus,
  runDbMigration,
  type User,
  type DbMigrationStatus,
} from "../api/usersApi";

export function AdminPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [migrationStatus, setMigrationStatus] = useState<DbMigrationStatus | null>(null);
  const [migrationBackupPath, setMigrationBackupPath] = useState<string | null>(null);
  const [isMigrating, setIsMigrating] = useState(false);

  const load = async () => {
    const [usersData, migrationData] = await Promise.all([listUsers(), getDbMigrationStatus()]);
    setUsers(usersData);
    setMigrationStatus(migrationData);
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

  const handleRunMigration = async () => {
    setIsMigrating(true);
    try {
      const result = await runDbMigration();
      setMigrationBackupPath(result.backupPath);
      setMigrationStatus(result.status);
    } finally {
      setIsMigrating(false);
    }
  };

  return (
    <Box>
      <Typography variant="h4" mb={2}>Administration</Typography>

      {migrationStatus?.requiresMigration && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <Stack spacing={1}>
            <Typography fontWeight={600}>
              Datenbank-Migration erforderlich ({migrationStatus.currentVersion} → {migrationStatus.targetVersion})
            </Typography>
            <Typography variant="body2">
              Bitte vor der weiteren Nutzung eine Migration starten. Vor der Migration wird automatisch ein Backup erstellt.
            </Typography>
            <Box>
              <Button variant="contained" onClick={handleRunMigration} disabled={isMigrating}>
                {isMigrating ? "Migration läuft..." : "Migration jetzt ausführen"}
              </Button>
            </Box>
          </Stack>
        </Alert>
      )}

      {!migrationStatus?.requiresMigration && migrationBackupPath && (
        <Alert severity="success" sx={{ mb: 2 }}>
          Migration erfolgreich. Backup: {migrationBackupPath}
        </Alert>
      )}

      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Name</TableCell>
              <TableCell>E-Mail</TableCell>
              <TableCell>Rolle</TableCell>
              <TableCell align="right">Aktionen</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <Typography fontWeight={500}>{user.displayName}</Typography>
                  <Typography variant="caption" color="text.secondary">@{user.username}</Typography>
                </TableCell>
                <TableCell>{user.email}</TableCell>
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
