// "Espelho" local dos dados do servidor, guardado em IndexedDB. Cada vez que
// uma requisição GET tem sucesso pela rede, o resultado é salvo aqui. Quando
// o app está offline, as leituras (e boa parte das escritas otimistas) usam
// esses dados em vez da rede.
import { STORES, idbGet, idbGetAll, idbPut, idbPutAll, idbDelete, idbClear } from "./db";

// biome-ignore lint: dados vindos do servidor são tratados como registros livres aqui
export type AnyRecord = Record<string, any>;

export function getTodayStr(): string {
  return new Date().toISOString().split("T")[0];
}

export function calcAge(birthDate: string): number {
  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) {
    age--;
  }
  return age;
}

// ---------------------------------------------------------------------------
// Crianças
// ---------------------------------------------------------------------------

export async function getAllChildren(): Promise<AnyRecord[]> {
  return idbGetAll<AnyRecord>(STORES.CHILDREN);
}

export async function getChildById(id: number): Promise<AnyRecord | undefined> {
  return idbGet<AnyRecord>(STORES.CHILDREN, id);
}

export async function replaceAllChildren(list: AnyRecord[]): Promise<void> {
  await idbClear(STORES.CHILDREN);
  await idbPutAll(STORES.CHILDREN, list);
}

export async function putChild(child: AnyRecord): Promise<void> {
  await idbPut(STORES.CHILDREN, child);
}

export async function deleteChildMirror(id: number): Promise<void> {
  await idbDelete(STORES.CHILDREN, id);
}

export async function getCongregationNameById(id: number | null | undefined): Promise<string | null> {
  if (id == null) return null;
  const cong = await idbGet<AnyRecord>(STORES.CONGREGATIONS, id);
  return cong?.name ?? null;
}

/** Recalcula age / congregationName / presentToday a partir do espelho local. */
export async function enrichChild(child: AnyRecord, presentTodayIds: Set<number>): Promise<AnyRecord> {
  const congregationName = await getCongregationNameById(child.congregationId);
  return {
    ...child,
    age: calcAge(child.birthDate),
    congregationName,
    presentToday: presentTodayIds.has(child.id),
  };
}

export async function getPresentTodayIds(): Promise<Set<number>> {
  const today = getTodayStr();
  const rows = await getAttendanceForDate(today);
  return new Set(rows.map((r) => (r.childId ?? r.child?.id) as number));
}

// ---------------------------------------------------------------------------
// Congregações
// ---------------------------------------------------------------------------

export async function getAllCongregations(): Promise<AnyRecord[]> {
  return idbGetAll<AnyRecord>(STORES.CONGREGATIONS);
}

export async function getCongregationById(id: number): Promise<AnyRecord | undefined> {
  return idbGet<AnyRecord>(STORES.CONGREGATIONS, id);
}

export async function replaceAllCongregations(list: AnyRecord[]): Promise<void> {
  await idbClear(STORES.CONGREGATIONS);
  await idbPutAll(STORES.CONGREGATIONS, list);
}

export async function putCongregation(congregation: AnyRecord): Promise<void> {
  await idbPut(STORES.CONGREGATIONS, congregation);
}

export async function deleteCongregationMirror(id: number): Promise<void> {
  await idbDelete(STORES.CONGREGATIONS, id);
}

// ---------------------------------------------------------------------------
// Presença por data
// ---------------------------------------------------------------------------

interface AttendanceByDateRecord {
  date: string;
  rows: AnyRecord[];
}

export async function getAttendanceForDate(date: string): Promise<AnyRecord[]> {
  const record = await idbGet<AttendanceByDateRecord>(STORES.ATTENDANCE_BY_DATE, date);
  return record?.rows ?? [];
}

export async function setAttendanceForDate(date: string, rows: AnyRecord[]): Promise<void> {
  await idbPut(STORES.ATTENDANCE_BY_DATE, { date, rows });
}

export async function getAllCachedAttendanceDates(): Promise<AttendanceByDateRecord[]> {
  return idbGetAll<AttendanceByDateRecord>(STORES.ATTENDANCE_BY_DATE);
}

export async function addAttendanceRow(date: string, row: AnyRecord): Promise<void> {
  const rows = await getAttendanceForDate(date);
  await setAttendanceForDate(date, [...rows, row]);
}

export async function removeAttendanceRow(date: string, childId: number): Promise<void> {
  const rows = await getAttendanceForDate(date);
  await setAttendanceForDate(
    date,
    rows.filter((r) => (r.childId ?? r.child?.id) !== childId),
  );
}

// ---------------------------------------------------------------------------
// Relatórios diários (usados no dashboard, histórico e relatórios)
// ---------------------------------------------------------------------------

export async function getAllDailyReports(): Promise<AnyRecord[]> {
  const rows = await idbGetAll<AnyRecord>(STORES.DAILY_REPORTS);
  return rows.sort((a, b) => (a.reportDate < b.reportDate ? 1 : -1));
}

export async function getDailyReport(date: string): Promise<AnyRecord | undefined> {
  return idbGet<AnyRecord>(STORES.DAILY_REPORTS, date);
}

export async function putDailyReport(report: AnyRecord): Promise<void> {
  await idbPut(STORES.DAILY_REPORTS, report);
}

/** Ajusta (soma/subtrai) as contagens de um relatório diário sem esperar o servidor. */
export async function bumpDailyReport(date: string, deltaGirls: number, deltaBoys: number): Promise<void> {
  const existing = (await getDailyReport(date)) ?? {
    reportDate: date,
    totalGirls: 0,
    totalBoys: 0,
    totalChildren: 0,
  };
  const totalGirls = Math.max(0, (existing.totalGirls ?? 0) + deltaGirls);
  const totalBoys = Math.max(0, (existing.totalBoys ?? 0) + deltaBoys);
  await putDailyReport({
    ...existing,
    totalGirls,
    totalBoys,
    totalChildren: totalGirls + totalBoys,
  });
}

// ---------------------------------------------------------------------------
// Diversos (usuário logado, últimas respostas do dashboard/relatórios)
// ---------------------------------------------------------------------------

export async function getMisc<T = AnyRecord>(key: string): Promise<T | undefined> {
  const record = await idbGet<{ key: string; value: T }>(STORES.MISC, key);
  return record?.value;
}

export async function setMisc<T = AnyRecord>(key: string, value: T): Promise<void> {
  await idbPut(STORES.MISC, { key, value });
}
