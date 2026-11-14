import { useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Plus,
  Search,
  Trash2,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import type { MajorConfig, Student } from '../../types/cbt.ts';

interface StudentsViewProps {
  students: Student[];
  majorsList: MajorConfig[];
}

type SortField = 'nis' | 'name' | 'kelas' | 'jurusan' | 'pin';
type SortDirection = 'asc' | 'desc';

const SORT_FIELD_LABELS: Record<SortField, string> = {
  nis: 'NIS',
  name: 'Nama Lengkap',
  kelas: 'Kelas',
  jurusan: 'Program Keahlian',
  pin: 'PIN Ujian',
};

interface ParsedImportRow {
  rowNumber: number;
  nis: string;
  name: string;
  kelas: string;
  jurusan: string;
  pin: string;
  gradeLevel: string;
  status: 'valid' | 'duplicate_db' | 'duplicate_batch' | 'incomplete';
  statusLabel: string;
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  if (delimiter === '\t') {
    return line.split('\t').map((cell) => cell.trim().replace(/^"|"$/g, ''));
  }

  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells;
}

function detectDelimiter(sampleLines: string[]): string {
  const joined = sampleLines.slice(0, 5).join('\n');
  if (joined.includes('\t')) return '\t';
  const semiCount = (joined.match(/;/g) || []).length;
  const commaCount = (joined.match(/,/g) || []).length;
  return semiCount >= commaCount && semiCount > 0 ? ';' : ',';
}

function deriveGradeLevel(kelas: string): string {
  const match = kelas.match(/^\s*(XII|XI|X)\b/i);
  return match ? match[1].toUpperCase() : 'XII';
}

function parseImportText(rawText: string, existingStudents: Student[]): ParsedImportRow[] {
  const clean = rawText.replace(/^\uFEFF/, '').trim();
  if (!clean) return [];

  const lines = clean
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) return [];

  const delimiter = detectDelimiter(lines);
  const existingNis = new Set(existingStudents.map((s) => s.nis.trim().toLowerCase()));
  const seenInBatch = new Set<string>();
  const rows: ParsedImportRow[] = [];

  lines.forEach((line, index) => {
    const cols = splitDelimitedLine(line, delimiter);
    const col0 = (cols[0] || '').trim();
    const col1 = (cols[1] || '').trim();
    const col2 = (cols[2] || '').trim();
    const col3 = (cols[3] || '').trim().toUpperCase();
    const col4 = (cols[4] || '').trim();

    if (
      index === 0 &&
      (col0.toLowerCase() === 'nis' ||
        col1.toLowerCase() === 'nama lengkap' ||
        col1.toLowerCase() === 'nama')
    ) {
      return;
    }

    const pin = col4 || '123456';
    const gradeLevel = deriveGradeLevel(col2);
    const nisKey = col0.toLowerCase();

    let status: ParsedImportRow['status'] = 'valid';
    let statusLabel = 'Siap Impor';

    if (!col0 || !col1 || !col2 || !col3) {
      status = 'incomplete';
      statusLabel = 'Data Tidak Lengkap';
    } else if (existingNis.has(nisKey)) {
      status = 'duplicate_db';
      statusLabel = 'NIS Sudah Terdaftar';
    } else if (seenInBatch.has(nisKey)) {
      status = 'duplicate_batch';
      statusLabel = 'Duplikat di Berkas';
    } else {
      seenInBatch.add(nisKey);
    }

    rows.push({
      rowNumber: index + 1,
      nis: col0,
      name: col1,
      kelas: col2,
      jurusan: col3,
      pin,
      gradeLevel,
      status,
      statusLabel,
    });
  });

  return rows;
}

export function StudentsView({ students, majorsList }: StudentsViewProps) {
  const [majorFilter, setMajorFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  const defaultMajorCode = majorsList[0]?.code || 'TKJ';
  const [nis, setNis] = useState('');
  const [name, setName] = useState('');
  const [kelas, setKelas] = useState(`XII ${defaultMajorCode} 1`);
  const [jurusan, setJurusan] = useState(defaultMajorCode);
  const [gradeLevel, setGradeLevel] = useState('XII');
  const [pin, setPin] = useState('123456');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const [importText, setImportText] = useState('');
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importNotice, setImportNotice] = useState<{
    importedCount: number;
    skippedCount: number;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const parsedImportRows = useMemo(
    () => parseImportText(importText, students),
    [importText, students]
  );

  const validImportRows = useMemo(
    () => parsedImportRows.filter((row) => row.status === 'valid'),
    [parsedImportRows]
  );

  const handleToggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const filteredStudents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = students.filter((s) => {
      if (majorFilter !== 'all' && s.jurusan !== majorFilter) return false;
      if (!q) return true;
      return (
        s.name.toLowerCase().includes(q) ||
        s.nis.toLowerCase().includes(q) ||
        s.kelas.toLowerCase().includes(q)
      );
    });

    if (!sortField) return filtered;

    const dirMultiplier = sortDirection === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const valA = (a[sortField] || '').trim();
      const valB = (b[sortField] || '').trim();
      const primary = valA.localeCompare(valB, 'id', {
        numeric: true,
        sensitivity: 'base',
      });
      if (primary !== 0) return primary * dirMultiplier;
      return a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }) * dirMultiplier;
    });
  }, [students, majorFilter, searchQuery, sortField, sortDirection]);

  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setIsSaving(true);
    try {
      const res = await fetch('/api/students', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nis, name, kelas, jurusan, gradeLevel, pin }),
      });
      if (!res.ok) {
        const data = await res.json();
        setErrorMsg(data.error || 'Gagal menambahkan siswa.');
        return;
      }
      setNis('');
      setName('');
      setShowAddModal(false);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    await fetch(`/api/students/${id}`, { method: 'DELETE' });
  };

  const handleDownloadTemplate = () => {
    const m1 = majorsList[0]?.code || 'TKJ';
    const m2 = majorsList[1]?.code || 'RPL';
    const m3 = majorsList[2]?.code || 'DKV';
    const csvLines = [
      'NIS,Nama Lengkap,Kelas,Program Keahlian,PIN Ujian',
      `20261001,Aditya Pratama,XII ${m1} 1,${m1},123456`,
      `20261002,Siti Rahmawati,XI ${m2} 2,${m2},654321`,
      `20261003,Bagas Ramadhan,X ${m3} 1,${m3},123456`,
    ];
    const blob = new Blob(['\uFEFF' + csvLines.join('\n')], {
      type: 'text/csv;charset=utf-8;',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'template-import-peserta-medina.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportError(null);
    setImportFileName(file.name);
    const text = await file.text();
    setImportText(text);
    e.target.value = '';
  };

  const handleOpenImportModal = () => {
    setImportError(null);
    setShowImportModal(true);
  };

  const handleCloseImportModal = () => {
    setShowImportModal(false);
    setImportError(null);
  };

  const handleSubmitImport = async () => {
    if (validImportRows.length === 0) {
      setImportError('Tidak ada baris data peserta yang valid untuk diimpor.');
      return;
    }

    setImportError(null);
    setIsImporting(true);
    try {
      const res = await fetch('/api/students/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          students: validImportRows.map((row) => ({
            nis: row.nis,
            name: row.name,
            kelas: row.kelas,
            jurusan: row.jurusan,
            gradeLevel: row.gradeLevel,
            pin: row.pin,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setImportError(data.error || 'Gagal mengimpor data peserta.');
        return;
      }

      const skippedFromParser = parsedImportRows.length - validImportRows.length;
      setImportNotice({
        importedCount: data.importedCount ?? validImportRows.length,
        skippedCount: (data.skippedCount ?? 0) + skippedFromParser,
      });
      setImportText('');
      setImportFileName(null);
      setShowImportModal(false);
    } catch {
      setImportError('Terjadi kesalahan jaringan saat mengimpor data peserta.');
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-900">
            Data Peserta Didik SMK Medina Bandung
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Daftar akun NIS dan PIN ujian untuk akses peserta ke Portal Ujian CBT.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 self-start lg:self-auto">
          <button
            type="button"
            onClick={handleOpenImportModal}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Upload className="w-4 h-4 text-slate-600" />
            <span>Import Data</span>
          </button>

          <button
            type="button"
            onClick={() => setShowAddModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-[#0F2A52] hover:bg-[#173B70] rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <UserPlus className="w-4 h-4" />
            <span>Tambah Peserta</span>
          </button>
        </div>
      </div>

      {importNotice && (
        <div className="flex items-center justify-between gap-4 bg-emerald-50 border border-emerald-200 text-emerald-900 px-4 py-3 rounded-xl text-sm">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
            <span>
              Berhasil mengimpor{' '}
              <strong className="font-mono tabular-nums">{importNotice.importedCount}</strong>{' '}
              peserta ujian baru
              {importNotice.skippedCount > 0 && (
                <>
                  {' '}
                  (
                  <span className="font-mono tabular-nums">{importNotice.skippedCount}</span> baris
                  dilewati karena duplikat atau belum lengkap)
                </>
              )}
              . Akun siswa sudah aktif dan dapat langsung digunakan untuk login.
            </span>
          </div>
          <button
            type="button"
            onClick={() => setImportNotice(null)}
            className="p-1 text-emerald-700 hover:text-emerald-900 rounded-md shrink-0"
            aria-label="Tutup pemberitahuan import"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari nama siswa, NIS, atau kelas..."
              className="w-full pl-10 pr-4 py-2 text-sm bg-white border border-slate-200 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg self-start overflow-x-auto">
            <button
              type="button"
              onClick={() => setMajorFilter('all')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                majorFilter === 'all'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Semua Jurusan
            </button>
            {majorsList.map((m) => (
              <button
                key={m.code}
                type="button"
                onClick={() => setMajorFilter(m.code)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  majorFilter === m.code
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {m.code}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-slate-200 rounded-lg px-3.5 py-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-500">Urutkan Field:</span>
            <select
              aria-label="Urutkan berdasarkan field"
              value={sortField ?? ''}
              onChange={(e) => {
                const next = e.target.value as SortField | '';
                setSortField(next === '' ? null : next);
              }}
              className="px-2.5 py-1.5 text-xs font-medium text-slate-800 bg-slate-50 border border-slate-200 rounded-md focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="">Urutan Bawaan</option>
              {(Object.keys(SORT_FIELD_LABELS) as SortField[]).map((fieldKey) => (
                <option key={fieldKey} value={fieldKey}>
                  {SORT_FIELD_LABELS[fieldKey]}
                </option>
              ))}
            </select>

            <div className="flex items-center gap-1 p-0.5 bg-slate-100 rounded-md">
              <button
                type="button"
                onClick={() => {
                  if (!sortField) setSortField('name');
                  setSortDirection('asc');
                }}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  sortField !== null && sortDirection === 'asc'
                    ? 'bg-white text-[#0F2A52] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ArrowUp className="w-3.5 h-3.5" />
                <span>A–Z (Ascending)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!sortField) setSortField('name');
                  setSortDirection('desc');
                }}
                className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 ${
                  sortField !== null && sortDirection === 'desc'
                    ? 'bg-white text-[#0F2A52] shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <ArrowDown className="w-3.5 h-3.5" />
                <span>Z–A (Descending)</span>
              </button>
            </div>

            {sortField && (
              <button
                type="button"
                onClick={() => setSortField(null)}
                className="text-xs text-slate-500 hover:text-slate-800 px-2 py-1"
              >
                Reset Urutan
              </button>
            )}
          </div>

          <div className="text-xs text-slate-500 font-mono tabular-nums">
            Menampilkan {filteredStudents.length} dari {students.length} peserta
            {sortField && (
              <span className="ml-2 text-slate-700 font-sans">
                · {SORT_FIELD_LABELS[sortField]} ({sortDirection === 'asc' ? 'A–Z' : 'Z–A'})
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                {(
                  [
                    { key: 'nis', label: 'NIS', pad: 'px-5' },
                    { key: 'name', label: 'Nama Lengkap', pad: 'px-4' },
                    { key: 'kelas', label: 'Kelas', pad: 'px-4' },
                    { key: 'jurusan', label: 'Program Keahlian', pad: 'px-4' },
                    { key: 'pin', label: 'PIN Ujian', pad: 'px-4' },
                  ] as Array<{ key: SortField; label: string; pad: string }>
                ).map((col) => {
                  const isActive = sortField === col.key;
                  return (
                    <th key={col.key} className={`py-3.5 ${col.pad}`}>
                      <button
                        type="button"
                        onClick={() => handleToggleSort(col.key)}
                        className={`inline-flex items-center gap-1.5 font-medium transition-colors whitespace-nowrap select-none ${
                          isActive
                            ? 'text-[#0F2A52] font-semibold'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                        title={`Urutkan ${col.label} (${
                          isActive && sortDirection === 'asc' ? 'Z–A / Descending' : 'A–Z / Ascending'
                        })`}
                      >
                        <span>{col.label}</span>
                        {isActive ? (
                          sortDirection === 'asc' ? (
                            <span className="inline-flex items-center gap-0.5 text-[11px] text-sky-700 font-mono">
                              <ArrowUp className="w-3.5 h-3.5" />
                              <span>A–Z</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-0.5 text-[11px] text-sky-700 font-mono">
                              <ArrowDown className="w-3.5 h-3.5" />
                              <span>Z–A</span>
                            </span>
                          )
                        ) : (
                          <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                        )}
                      </button>
                    </th>
                  );
                })}
                <th className="py-3.5 px-5 text-right">Hapus</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {filteredStudents.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 px-5 text-center text-slate-500">
                    Tidak ada peserta yang sesuai dengan pencarian.
                  </td>
                </tr>
              ) : (
                filteredStudents.map((stu) => (
                  <tr key={stu.id} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3.5 px-5 font-mono tabular-nums text-slate-700 font-medium">
                      {stu.nis}
                    </td>
                    <td className="py-3.5 px-4 font-medium text-slate-900">{stu.name}</td>
                    <td className="py-3.5 px-4 text-slate-700">{stu.kelas}</td>
                    <td className="py-3.5 px-4 text-slate-600">{stu.jurusan}</td>
                    <td className="py-3.5 px-4 font-mono tabular-nums text-slate-700">
                      {stu.pin}
                    </td>
                    <td className="py-3.5 px-5 text-right">
                      <button
                        type="button"
                        onClick={() => handleDelete(stu.id)}
                        aria-label={`Hapus ${stu.name}`}
                        className="p-1.5 text-slate-400 hover:text-red-600 rounded-lg transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showAddModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white border border-slate-200 rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 pb-3">
              <h3 className="text-lg font-semibold text-slate-900">Tambah Peserta Ujian</h3>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddStudent} className="space-y-4">
              {errorMsg && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">
                  {errorMsg}
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">NIS</label>
                <input
                  type="text"
                  required
                  value={nis}
                  onChange={(e) => setNis(e.target.value)}
                  placeholder="Contoh: 20241099"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Nama Lengkap Siswa
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Nama sesuai dapodik"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tingkat &amp; Jurusan
                  </label>
                  <select
                    value={jurusan}
                    onChange={(e) => {
                      const j = e.target.value;
                      setJurusan(j);
                      setKelas(`${gradeLevel} ${j} 1`);
                    }}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    {majorsList.map((m) => (
                      <option key={m.code} value={m.code}>
                        {m.code} — {m.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Tingkat
                  </label>
                  <select
                    value={gradeLevel}
                    onChange={(e) => {
                      const g = e.target.value;
                      setGradeLevel(g);
                      setKelas(`${g} ${jurusan} 1`);
                    }}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white"
                  >
                    <option value="X">X</option>
                    <option value="XI">XI</option>
                    <option value="XII">XII</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Rombel / Kelas
                  </label>
                  <input
                    type="text"
                    required
                    value={kelas}
                    onChange={(e) => setKelas(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    PIN Ujian
                  </label>
                  <input
                    type="text"
                    required
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg font-mono"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-[#0F2A52] hover:bg-[#173B70] rounded-lg"
                >
                  <Plus className="w-4 h-4" />
                  <span>{isSaving ? 'Menyimpan...' : 'Simpan Peserta'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showImportModal && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white border border-slate-200 rounded-xl max-w-4xl w-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <div>
                <h3 className="text-lg font-semibold text-slate-900">
                  Import Data Peserta Ujian
                </h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  Urutan kolom: <span className="font-medium text-slate-800">NIS</span>,{' '}
                  <span className="font-medium text-slate-800">Nama Lengkap</span>,{' '}
                  <span className="font-medium text-slate-800">Kelas</span>,{' '}
                  <span className="font-medium text-slate-800">Program Keahlian</span>,{' '}
                  <span className="font-medium text-slate-800">PIN Ujian</span>.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCloseImportModal}
                className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-5 overflow-y-auto flex-1">
              {importError && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3.5 py-2.5 rounded-lg">
                  {importError}
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg p-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                    <FileSpreadsheet className="w-4 h-4 text-[#0F2A52]" />
                    <span>Unggah Berkas CSV atau Salin dari Excel</span>
                  </div>
                  <p className="text-xs text-slate-600">
                    Mendukung pemisah koma (<code className="font-mono">,</code>), titik koma (
                    <code className="font-mono">;</code>), atau salin-tempel langsung dari Excel /
                    Google Sheets.
                    {importFileName && (
                      <span className="ml-1.5 font-medium text-slate-800">
                        Berkas dipilih: {importFileName}
                      </span>
                    )}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={handleDownloadTemplate}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg whitespace-nowrap shrink-0"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Unduh Template CSV</span>
                  </button>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,.txt"
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-white bg-[#0F2A52] hover:bg-[#173B70] rounded-lg whitespace-nowrap shrink-0"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    <span>Pilih Berkas CSV</span>
                  </button>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-slate-700">
                    Data Peserta (CSV / Tempel Baris Excel)
                  </label>
                  {importText && (
                    <button
                      type="button"
                      onClick={() => {
                        setImportText('');
                        setImportFileName(null);
                      }}
                      className="text-xs text-slate-500 hover:text-slate-800"
                    >
                      Bersihkan Teks
                    </button>
                  )}
                </div>
                <textarea
                  rows={5}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder={`NIS,Nama Lengkap,Kelas,Program Keahlian,PIN Ujian\n20261001,Aditya Pratama,XII TKJ 1,TKJ,123456\n20261002,Siti Rahmawati,XI RPL 2,RPL,654321`}
                  className="w-full px-3.5 py-2.5 text-xs font-mono border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Pratinjau Data Import
                  </h4>
                  <div className="text-xs text-slate-600 font-mono tabular-nums">
                    Total baris: {parsedImportRows.length} · Siap impor:{' '}
                    <span className="font-semibold text-emerald-700">
                      {validImportRows.length}
                    </span>{' '}
                    · Dilewati:{' '}
                    <span className="font-semibold text-amber-700">
                      {parsedImportRows.length - validImportRows.length}
                    </span>
                  </div>
                </div>

                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="overflow-x-auto max-h-60">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-slate-500">
                        <tr>
                          <th className="py-2.5 px-3">NIS</th>
                          <th className="py-2.5 px-3">Nama Lengkap</th>
                          <th className="py-2.5 px-3">Kelas</th>
                          <th className="py-2.5 px-3">Program Keahlian</th>
                          <th className="py-2.5 px-3">PIN Ujian</th>
                          <th className="py-2.5 px-3">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {parsedImportRows.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-8 px-4 text-center text-slate-500">
                              Belum ada data terbaca. Pilih berkas CSV atau tempel baris data di
                              atas untuk melihat pratinjau.
                            </td>
                          </tr>
                        ) : (
                          parsedImportRows.map((row) => (
                            <tr
                              key={`${row.rowNumber}-${row.nis}`}
                              className={row.status === 'valid' ? 'bg-white' : 'bg-slate-50/80'}
                            >
                              <td className="py-2 px-3 font-mono tabular-nums text-slate-800">
                                {row.nis || '-'}
                              </td>
                              <td className="py-2 px-3 font-medium text-slate-900">
                                {row.name || '-'}
                              </td>
                              <td className="py-2 px-3 text-slate-700">{row.kelas || '-'}</td>
                              <td className="py-2 px-3 text-slate-700">{row.jurusan || '-'}</td>
                              <td className="py-2 px-3 font-mono tabular-nums text-slate-700">
                                {row.pin}
                              </td>
                              <td className="py-2 px-3">
                                <span
                                  className={`font-medium ${
                                    row.status === 'valid'
                                      ? 'text-emerald-700'
                                      : row.status === 'incomplete'
                                        ? 'text-red-700'
                                        : 'text-amber-700'
                                  }`}
                                >
                                  {row.statusLabel}
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2.5 px-6 py-4 border-t border-slate-200 bg-slate-50">
              <button
                type="button"
                onClick={handleCloseImportModal}
                className="px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 rounded-lg whitespace-nowrap shrink-0"
              >
                Batal
              </button>
              <button
                type="button"
                disabled={isImporting || validImportRows.length === 0}
                onClick={handleSubmitImport}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0F2A52] hover:bg-[#173B70] disabled:opacity-50 disabled:cursor-not-allowed rounded-lg whitespace-nowrap shrink-0"
              >
                <Upload className="w-4 h-4" />
                <span>
                  {isImporting
                    ? 'Mengimpor...'
                    : `Import ${validImportRows.length} Peserta`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
