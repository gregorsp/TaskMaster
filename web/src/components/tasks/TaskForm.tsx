import { useState, useEffect, useMemo } from "react";
import {
  Dialog, DialogContent, DialogTitle, TextField, Button, Stack, Box,
  FormControlLabel, Switch, MenuItem, Typography, Chip, Autocomplete,
  RadioGroup, Radio, FormControl, FormLabel,
} from "@mui/material";
import { createTask, updateTask, type CreateTaskInput, type UpdateTaskInput, type TaskWithRelations } from "../../api/tasksApi";
import { listCategories, type Category } from "../../api/categoriesApi";
import { listUsersPicker, type UserPickerItem } from "../../api/usersApi";
import { useNotify } from "../../context/NotifyContext";
import { useAuth } from "../../context/AuthContext";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
  task?: TaskWithRelations | null;
}

const DAYS: { value: string; label: string }[] = [
  { value: "MO", label: "Mo" }, { value: "TU", label: "Di" },
  { value: "WE", label: "Mi" }, { value: "TH", label: "Do" },
  { value: "FR", label: "Fr" }, { value: "SA", label: "Sa" },
  { value: "SU", label: "So" },
];

const MONTHS = [
  "Januar","Februar","März","April","Mai","Juni",
  "Juli","August","September","Oktober","November","Dezember"
];

function parseRRule(rule: string | null): {
  freq: string; interval: number; selectedDays: string[]; monthDay: string;
  useNthWeekday: boolean; nthWeekday: { nth: number; day: string };
  yearMonth: number; yearDay: string;
} {
  const defaults = { freq: "WEEKLY", interval: 1, selectedDays: [] as string[],
    monthDay: "", useNthWeekday: false, nthWeekday: { nth: 1, day: "MO" },
    yearMonth: 1, yearDay: "" };
  if (!rule) return defaults;
  try {
    const parts = rule.split(";").map(p => p.trim());
    const freq = parts[0]?.replace("FREQ=", "") || "WEEKLY";
    const interval = Number(parts.find(p => p.startsWith("INTERVAL="))?.replace("INTERVAL=", "") || "1");
    const byday = parts.find(p => p.startsWith("BYDAY="))?.replace("BYDAY=", "") || "";
    const bymonthday = parts.find(p => p.startsWith("BYMONTHDAY="))?.replace("BYMONTHDAY=", "") || "";
    const bymonth = parts.find(p => p.startsWith("BYMONTH="))?.replace("BYMONTH=", "") || "";

    let selectedDays: string[] = [];
    let useNthWeekday = false;
    let nthWeekday = { nth: 1, day: "MO" };

    if (freq === "WEEKLY" && byday) {
      selectedDays = byday.split(",").filter(d => /^[A-Z]{2}$/.test(d));
    }
    if (freq === "MONTHLY" && byday) {
      const m = byday.match(/^(-?\d+)([A-Z]{2})$/);
      if (m) { useNthWeekday = true; nthWeekday = { nth: Number(m[1]), day: m[2] }; }
    }

    return {
      freq, interval, selectedDays,
      monthDay: freq === "MONTHLY" && bymonthday ? bymonthday : "",
      useNthWeekday, nthWeekday,
      yearMonth: freq === "YEARLY" && bymonth ? Number(bymonth) : 1,
      yearDay: freq === "YEARLY" && bymonthday ? bymonthday : "",
    };
  } catch {
    return defaults;
  }
}

function toInputDate(d: Date | null): string {
  if (!d) return "";
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

export function TaskForm({ open, onClose, onCreated, task }: Props) {
  const isEdit = !!task;
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [isImportant, setIsImportant] = useState(false);
  const [pomodoros, setPomodoros] = useState<number | null>(null);
  const [urgencyMode, setUrgencyMode] = useState<"never" | "always" | "before_days" | "before_percent">("before_days");
  const [urgencyValue, setUrgencyValue] = useState<number>(3);
  const [recurrenceType, setRecurrenceType] = useState<"none" | "rrule" | "on_completion">("none");
  const [freq, setFreq] = useState("WEEKLY");
  const [interval, setInterval] = useState(1);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [monthDay, setMonthDay] = useState("");
  const [nthWeekday, setNthWeekday] = useState<{ nth: number; day: string }>({ nth: 1, day: "MO" });
  const [useNthWeekday, setUseNthWeekday] = useState(false);
  const [yearMonth, setYearMonth] = useState(1);
  const [yearDay, setYearDay] = useState("");
  const [selectedCategories, setSelectedCategories] = useState<Category[]>([]);
  const [selectedAssignees, setSelectedAssignees] = useState<UserPickerItem[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [users, setUsers] = useState<UserPickerItem[]>([]);
  const [loading, setLoading] = useState(false);
  const notify = useNotify();
  const { user: currentUser } = useAuth();

  useEffect(() => {
    if (open) {
      listCategories().then(setCategories).catch(() => []);
      listUsersPicker().then((all) => {
        setUsers(all);
        if (!task && currentUser) {
          const me = all.find((u) => u.id === currentUser.id);
          if (me) setSelectedAssignees([me]);
        }
      }).catch(() => []);
    }
  }, [open]);

  useEffect(() => {
    if (open && task) {
      try {
        setTitle(task.title || "");
        setDescription(task.description || "");
        setDueDate(toInputDate(task.dueAt ? new Date(task.dueAt) : (task.baseDate ? new Date(task.baseDate) : null)));
        setIsPrivate(task.isPrivate ?? false);
        setIsImportant(task.isImportant ?? false);
        setPomodoros(task.pomodoros ?? null);
        setUrgencyMode(task.urgencyMode || "before_days");
        setUrgencyValue(task.urgencyValue ?? 3);
        setRecurrenceType(task.recurrenceType || "none");
        setSelectedCategories((task.categories || []) as Category[]);
        setSelectedAssignees(task.assignees || []);
        if (task.recurrenceType === "rrule" && task.recurrenceRule) {
          const parsed = parseRRule(task.recurrenceRule);
          setFreq(parsed.freq);
          setInterval(parsed.interval);
          setSelectedDays(parsed.selectedDays);
          setMonthDay(parsed.monthDay);
          setUseNthWeekday(parsed.useNthWeekday);
          setNthWeekday(parsed.nthWeekday);
          setYearMonth(parsed.yearMonth);
          setYearDay(parsed.yearDay);
        }
      } catch (e) { console.error("TaskForm prefill error:", e); }
    } else if (open && !task) {
      setTitle(""); setDescription(""); setDueDate(""); setIsPrivate(false);
      setIsImportant(false); setPomodoros(null); setUrgencyMode("before_days"); setUrgencyValue(3); setRecurrenceType("none");
      setFreq("WEEKLY"); setInterval(1); setSelectedDays([]);
      setMonthDay(""); setUseNthWeekday(false); setSelectedCategories([]);
      const me = users.find((u) => u.id === currentUser?.id);
      setSelectedAssignees(me ? [me] : []);
    }
  }, [open, task]);

  const buildRRule = (): string | undefined => {
    if (recurrenceType !== "rrule") return undefined;
    let rule = `FREQ=${freq}`;
    if (interval > 1) rule += `;INTERVAL=${interval}`;
    if (freq === "WEEKLY" && selectedDays.length > 0) rule += `;BYDAY=${selectedDays.join(",")}`;
    if (freq === "MONTHLY") {
      if (useNthWeekday) rule += `;BYDAY=${nthWeekday.nth}${nthWeekday.day}`;
      else if (monthDay) rule += `;BYMONTHDAY=${monthDay}`;
    }
    if (freq === "YEARLY") {
      if (yearMonth) rule += `;BYMONTH=${yearMonth}`;
      if (yearDay) rule += `;BYMONTHDAY=${yearDay}`;
    }
    return rule;
  };

  const ruleStr = buildRRule();

  const previewDates: Date[] = [];

  const handleSubmit = async () => {
    if (!title.trim()) return;
    setLoading(true);
    try {
      if (isEdit && task) {
        const input: UpdateTaskInput = {
          title: title.trim(),
          description: description.trim() || null,
          dueAt: dueDate ? new Date(dueDate).toISOString() : null,
          isImportant, isPrivate, pomodoros, recurrenceType, urgencyMode, urgencyValue,
          recurrenceRule: ruleStr || null,
          categoryIds: selectedCategories.map((c) => c.id),
          assigneeIds: selectedAssignees.map((u) => u.id),
        };
        await updateTask(task.id, input);
        notify("Aufgabe gespeichert");
      } else {
        const input: CreateTaskInput = {
          title: title.trim(),
          description: description.trim() || undefined,
          dueAt: dueDate ? new Date(dueDate).toISOString() : undefined,
          isImportant, isPrivate, pomodoros, recurrenceType, urgencyMode, urgencyValue,
          recurrenceRule: ruleStr,
          categoryIds: selectedCategories.map((c) => c.id),
          assigneeIds: selectedAssignees.map((u) => u.id),
        };
        await createTask(input);
        notify("Aufgabe erstellt");
      }
      onCreated();
    } catch {
      notify("Fehler beim Speichern", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{isEdit ? "Aufgabe bearbeiten" : "Neue Aufgabe"}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          <TextField label="Titel" value={title} onChange={(e) => setTitle(e.target.value)} required fullWidth autoFocus />
          <TextField label="Beschreibung" value={description} onChange={(e) => setDescription(e.target.value)} multiline rows={3} fullWidth />
          <TextField label={recurrenceType === "rrule" ? "Startdatum (erste Fälligkeit)" : "Fälligkeit"} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} InputLabelProps={{ shrink: true }} fullWidth />
          <Stack direction="row" spacing={2}>
            <FormControlLabel control={<Switch checked={isImportant} onChange={(e) => setIsImportant(e.target.checked)} />} label="Wichtig" />
            <FormControlLabel control={<Switch checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />} label="Privat" />
          </Stack>

          <TextField
            label="Pomodoros"
            type="number"
            value={pomodoros ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              setPomodoros(v === "" ? null : Math.max(1, Number(v) || 1));
            }}
            inputProps={{ min: 1, max: 999 }}
            placeholder="Keine Angabe"
            helperText="1 Pomodoro ≈ 25 Minuten – leer lassen für keinen Schätzwert"
            fullWidth
          />

          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="body2" sx={{ minWidth: 90 }}>Dringend:</Typography>
            <TextField select size="small" value={urgencyMode} onChange={(e) => setUrgencyMode(e.target.value as typeof urgencyMode)} sx={{ minWidth: 140 }}>
              <MenuItem value="never">Nie</MenuItem>
              <MenuItem value="always">Immer</MenuItem>
              <MenuItem value="before_days">× Tage vorher</MenuItem>
              <MenuItem value="before_percent">Nach x% der Zeit</MenuItem>
            </TextField>
            {(urgencyMode === "before_days" || urgencyMode === "before_percent") && (
              <TextField type="number" size="small" value={urgencyValue} onChange={(e) => setUrgencyValue(Number(e.target.value) || 1)}
                inputProps={{ min: 1, max: 99 }} sx={{ width: 70 }}
                label={urgencyMode === "before_days" ? "Tage" : "%"} />
            )}
          </Stack>
          <FormControl component="fieldset">
            <FormLabel component="legend">Wiederholung</FormLabel>
            <RadioGroup value={recurrenceType} onChange={(e) => setRecurrenceType(e.target.value as typeof recurrenceType)} row>
              <FormControlLabel value="none" control={<Radio />} label="Keine" />
              <FormControlLabel value="on_completion" control={<Radio />} label="Bei Erledigung" />
              <FormControlLabel value="rrule" control={<Radio />} label="Cron" />
            </RadioGroup>
          </FormControl>
          {recurrenceType === "rrule" && (
            <Stack spacing={1}>
              <Stack direction="row" spacing={1}>
                <TextField select label="Häufigkeit" value={freq} onChange={(e) => setFreq(e.target.value)} sx={{ minWidth: 140 }}>
                  <MenuItem value="DAILY">Täglich</MenuItem><MenuItem value="WEEKLY">Wöchentlich</MenuItem>
                  <MenuItem value="MONTHLY">Monatlich</MenuItem><MenuItem value="YEARLY">Jährlich</MenuItem>
                </TextField>
                <TextField type="number" label="Alle X" value={interval} onChange={(e) => setInterval(Number(e.target.value) || 1)} inputProps={{ min:1, max:99 }} sx={{ width:100 }} />
              </Stack>
              {freq === "WEEKLY" && <Box><Typography variant="caption">Wochentage:</Typography><Stack direction="row" gap={0.5} mt={0.5}>{DAYS.map(d=><Chip key={d.value} label={d.label} size="small" variant={selectedDays.includes(d.value)?"filled":"outlined"} color={selectedDays.includes(d.value)?"primary":"default"} onClick={()=>setSelectedDays(p=>p.includes(d.value)?p.filter(v=>v!==d.value):[...p,d.value])} />)}</Stack></Box>}
              {freq === "MONTHLY" && (<Stack spacing={1}>
                <Stack direction="row" spacing={1}><TextField select label="Tag des Monats" value={useNthWeekday?"":monthDay} onChange={e=>{setUseNthWeekday(false);setMonthDay(e.target.value)}} sx={{flex:1}} disabled={useNthWeekday}>{Array.from({length:31},(_,i)=><MenuItem key={i+1} value={String(i+1)}>{i+1}.</MenuItem>)}</TextField></Stack>
                <Typography variant="caption" textAlign="center">oder</Typography>
                <Stack direction="row" spacing={1} alignItems="center">
                  <TextField select label="Der/die" value={useNthWeekday?String(nthWeekday.nth):""} onChange={e=>{setUseNthWeekday(true);setNthWeekday(p=>({...p,nth:Number(e.target.value)}))}} sx={{flex:1}} disabled={!useNthWeekday} onClick={()=>!useNthWeekday&&setUseNthWeekday(true)}>{[["1","1."],["2","2."],["3","3."],["4","4."],["-1","Letzte(r)"]].map(([v,l])=><MenuItem key={v} value={v}>{l}</MenuItem>)}</TextField>
                  <TextField select label="Wochentag" value={useNthWeekday?nthWeekday.day:""} onChange={e=>{setUseNthWeekday(true);setNthWeekday(p=>({...p,day:e.target.value}))}} sx={{flex:1}} disabled={!useNthWeekday} onClick={()=>!useNthWeekday&&setUseNthWeekday(true)}>{DAYS.map(d=><MenuItem key={d.value} value={d.value}>{d.label}</MenuItem>)}</TextField>
                </Stack>
              </Stack>)}
              {freq === "YEARLY" && (<Stack direction="row" spacing={1}><TextField select label="Monat" value={String(yearMonth)} onChange={e=>setYearMonth(Number(e.target.value))} sx={{flex:1}}>{MONTHS.map((m,i)=><MenuItem key={i+1} value={String(i+1)}>{m}</MenuItem>)}</TextField><TextField label="Tag" type="number" value={yearDay} onChange={e=>setYearDay(e.target.value)} inputProps={{min:1,max:31}} sx={{width:90}} /></Stack>)}
              {previewDates.length>0&&<Box sx={{bgcolor:"background.paper",p:1.5,borderRadius:1,border:1,borderColor:"divider"}}><Typography variant="caption" color="text.secondary" fontWeight={600}>Nächste Termine:</Typography>{previewDates.map((d,i)=><Typography key={i} variant="body2" color="text.secondary">{d.toLocaleDateString("de-DE",{weekday:"short",day:"2-digit",month:"2-digit",year:"numeric"})}</Typography>)}</Box>}
            </Stack>
          )}
          <Autocomplete multiple options={categories} getOptionLabel={c=>c.name} value={selectedCategories} onChange={(_,v)=>setSelectedCategories(v)} renderInput={p=><TextField {...p} label="Kategorien" />} renderOption={(props,opt)=>(<li {...props} key={opt.id}><Box sx={{display:"flex",alignItems:"center",gap:1}}><Box sx={{width:12,height:12,borderRadius:"50%",bgcolor:opt.color}}/>{opt.name}</Box></li>)} />
          <Autocomplete multiple options={users} getOptionLabel={u=>u.displayName} value={selectedAssignees} onChange={(_,v)=>setSelectedAssignees(v)} renderInput={p=><TextField {...p} label="Verantwortlich" />} />
          <Stack direction="row" justifyContent="flex-end" gap={1} mt={2}>
            <Button onClick={onClose}>Abbrechen</Button>
            <Button variant="contained" onClick={handleSubmit} disabled={loading||!title.trim()}>{isEdit?"Speichern":"Erstellen"}</Button>
          </Stack>
        </Stack>
      </DialogContent>
    </Dialog>
  );
}
