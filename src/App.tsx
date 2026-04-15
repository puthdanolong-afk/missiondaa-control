/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useMemo, Fragment } from 'react';
import { 
  collection, 
  query, 
  onSnapshot, 
  setDoc, 
  doc, 
  deleteDoc, 
  addDoc, 
  orderBy,
  where,
  getDocs,
  updateDoc,
  getDoc,
  writeBatch
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  signOut, 
  onAuthStateChanged, 
  User 
} from 'firebase/auth';
import { 
  format, 
  getDaysInMonth, 
  startOfMonth, 
  endOfMonth,
  startOfWeek,
  endOfWeek,
  eachDayOfInterval,
  isSameMonth,
  isSameDay,
  addMonths, 
  subMonths,
  getYear,
  getMonth,
  isToday,
  differenceInCalendarDays,
  startOfDay
} from 'date-fns';
import { km } from 'date-fns/locale';
import { 
  ref, 
  uploadBytes, 
  uploadBytesResumable,
  getDownloadURL 
} from 'firebase/storage';
import { 
  Lock,
  Mail,
  Key,
  LogOut, 
  Plus, 
  Trash2, 
  ChevronLeft, 
  ChevronRight, 
  ChevronDown,
  User as UserIcon,
  UserPlus, 
  Settings,
  Save,
  X,
  Calendar,
  Users,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  FileUp,
  Upload,
  FileSpreadsheet,
  FileText,
  MessageSquare,
  Search,
  Layout,
  Table as TableIcon,
  Bell,
  Info,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  FilePlus,
  Filter,
  Eye,
  EyeOff,
  Download,
  Loader2,
  TrendingUp,
  ShieldCheck,
  Printer,
  Palette,
  Share2,
  FileDown
} from 'lucide-react';
import * as XLSX from 'xlsx';
import { motion, AnimatePresence } from 'motion/react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import { useRef } from 'react';
import { 
  db, 
  auth, 
  storage, 
  googleProvider, 
  handleFirestoreError, 
  OperationType,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  secondaryAuth,
  updateProfile
} from './firebase';
import { cn } from './lib/utils';

// --- Types ---

interface Official {
  id: string;
  name: string;
  gender?: 'M' | 'F' | 'Other';
  position: string;
  group: string;
  groupDescription?: string;
  order?: number;
}

interface Mission {
  id: string;
  officialId: string;
  month: number;
  year: number;
  days: number[];
  notes?: Record<string, string>;
}

interface AppUser {
  uid: string;
  email: string;
  displayName: string;
  photoURL: string;
  role: 'admin' | 'editor' | 'viewer';
}

interface Group {
  id: string;
  name: string;
  order: number;
}

interface Committee {
  id: string;
  leaderName: string;     // ឈ្មោះថ្នាក់ដឹកនាំ
  leaderPosition: string; // តួនាទី
  documentNumber: string; // លេខលិខិត
  objective: string;      // កម្មវត្ថុ
  ministry: string;       // ក្រសួង
  fileUrl?: string;       // ឯកសារ (Can be a Storage URL or a Firestore doc ID)
  notes?: string;         // ផ្សេងៗ
  order?: number;
  createdAt?: string;
}

interface FileStorage {
  id?: string;
  name: string;
  type: string;
  data?: string; // base64 (only if totalChunks is 1 or undefined)
  size: number;
  totalChunks?: number;
  createdAt: string;
}

interface FileChunk {
  fileId: string;
  chunkIndex: number;
  data: string; // base64 chunk
}

// --- Utilities ---

const fileToBase64 = (file: File): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const base64String = reader.result as string;
      // Remove the prefix (e.g., "data:application/pdf;base64,")
      const base64Data = base64String.split(',')[1];
      resolve(base64Data);
    };
    reader.onerror = error => reject(error);
  });
};

const compressImage = async (file: File, iteration = 0): Promise<File> => {
  if (!file.type.startsWith('image/')) return file;
  if (file.size <= 750 * 1024) return file; 
  if (iteration > 2) return file; // Prevent infinite loops

  console.log(`Compressing image (Iteration ${iteration}): ${file.name} (${(file.size / 1024).toFixed(0)}KB)`);
  
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = async () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;
        
        // More aggressive scaling per iteration
        const scaleFactor = iteration === 0 ? 0.8 : (iteration === 1 ? 0.6 : 0.4);
        const MAX_DIM = 1600 * scaleFactor;
        
        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          } else {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(file);
          return;
        }
        
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        
        // Lower quality per iteration
        const quality = iteration === 0 ? 0.6 : (iteration === 1 ? 0.4 : 0.2);
        
        canvas.toBlob(async (blob) => {
          if (blob) {
            const compressedFile = new File([blob], file.name.replace(/\.[^/.]+$/, "") + ".jpg", {
              type: 'image/jpeg',
              lastModified: Date.now(),
            });
            
            console.log(`Result of iteration ${iteration}: ${(compressedFile.size / 1024).toFixed(0)}KB`);
            
            // If still too large, try again with more aggressive settings
            if (compressedFile.size > 750 * 1024 && iteration < 2) {
              resolve(await compressImage(compressedFile, iteration + 1));
            } else {
              resolve(compressedFile);
            }
          } else {
            resolve(file);
          }
        }, 'image/jpeg', quality);
      };
      img.onerror = () => resolve(file);
    };
    reader.onerror = () => resolve(file);
  });
};

const ALL_GROUPS = [
  'Leadership',
  'General Affairs',
  'Admin Office',
  'Personnel Office',
  'Protocol Office',
  'Archiving Office',
  'Security Office',
  'Contract Officers',
  'Technical Team'
];

const getGroupNameKh = (group: string) => {
  const mapping: Record<string, string> = {
    'General Affairs': 'នាយកដ្ឋានរដ្ឋបាល',
    'Leadership': 'ថ្នាក់ដឹកនាំ',
    'Technical Team': 'ក្រុមបច្ចេកទេស',
    'Admin Office': 'ការិយាល័យរដ្ឋបាល',
    'Personnel Office': 'ការិយាល័យបុគ្គលិក',
    'Protocol Office': 'ការិយាល័យពិធីការ',
    'Archiving Office': 'ការិយាល័យតម្កល់ឯកសារ',
    'Security Office': 'ការិយាល័យសន្តិសុខ',
    'Contract Officers': 'មន្ត្រីជាប់កិច្ចសន្យា បម្រើការងារសណ្ដាប់ធ្នាប់ និងពិធីការ'
  };
  return mapping[group] || group;
};

const kmMonths = [
  'មករា', 'កុម្ភៈ', 'មីនា', 'មេសា', 'ឧសភា', 'មិថុនា',
  'កក្កដា', 'សីហា', 'កញ្ញា', 'តុលា', 'វិច្ឆិកា', 'ធ្នូ'
];

// --- Components ---

import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell,
  AreaChart,
  Area,
  LineChart,
  Line
} from 'recharts';

// --- Dashboard Component ---

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white dark:bg-gray-900 p-4 rounded-2xl shadow-xl border border-gray-100 dark:border-gray-800 animate-in fade-in zoom-in duration-200">
        <p className="text-sm font-bold text-gray-900 dark:text-gray-100 mb-1">{label}</p>
        {payload.map((entry: any, index: number) => (
          <div key={index} className="flex items-center gap-2 text-xs">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color || entry.fill }} />
            <span className="text-gray-500 dark:text-gray-400">{entry.name}:</span>
            <span className="font-bold text-gray-900 dark:text-gray-100">{entry.value} {entry.unit || 'ថ្ងៃ'}</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

const Dashboard = ({ officials, missions, currentDate, theme, isDarkMode }: { officials: Official[], missions: Mission[], currentDate: Date, theme: string, isDarkMode: boolean }) => {
  const month = getMonth(currentDate) + 1;
  const year = getYear(currentDate);
  
  const getThemeHex = (t: string) => {
    switch (t) {
      case 'dark': return '#111827';
      case 'emerald': return '#059669';
      case 'indigo': return '#4f46e5';
      case 'rose': return '#e11d48';
      default: return '#2563eb';
    }
  };

  const themeHex = getThemeHex(theme);
  
  const currentMonthMissions = missions.filter(m => m.month === month && m.year === year);
  const totalMissions = currentMonthMissions.reduce((acc, m) => acc + m.days.length, 0);
  const uniqueOfficialsOnMission = new Set(currentMonthMissions.filter(m => m.days.length > 0).map(m => m.officialId)).size;
  
  const uniqueWomenOnMission = useMemo(() => {
    const womenOnMissionIds = new Set(
      currentMonthMissions
        .filter(m => m.days.length > 0)
        .map(m => m.officialId)
        .filter(id => {
          const official = officials.find(o => o.id === id);
          return official?.gender === 'F';
        })
    );
    return womenOnMissionIds.size;
  }, [currentMonthMissions, officials]);

  const groupData = useMemo(() => {
    const groups: Record<string, number> = {};
    currentMonthMissions.forEach(m => {
      const official = officials.find(o => o.id === m.officialId);
      if (official) {
        const groupName = getGroupNameKh(official.group);
        groups[groupName] = (groups[groupName] || 0) + m.days.length;
      }
    });
    return Object.entries(groups).map(([name, value]) => ({ name, value }));
  }, [currentMonthMissions, officials]);

  const dailyTrendData = useMemo(() => {
    const daysInMonth = getDaysInMonth(currentDate);
    const data = Array.from({ length: daysInMonth }, (_, i) => ({
      day: `ថ្ងៃទី ${i + 1}`,
      count: 0
    }));

    currentMonthMissions.forEach(m => {
      m.days.forEach(day => {
        if (day >= 1 && day <= daysInMonth) {
          data[day - 1].count++;
        }
      });
    });

    return data;
  }, [currentMonthMissions, currentDate]);

  const genderBreakdownData = useMemo(() => {
    const groups: Record<string, { name: string, male: number, female: number }> = {};
    
    currentMonthMissions.forEach(m => {
      const official = officials.find(o => o.id === m.officialId);
      if (official) {
        const groupName = getGroupNameKh(official.group);
        if (!groups[groupName]) {
          groups[groupName] = { name: groupName, male: 0, female: 0 };
        }
        if (official.gender === 'M') {
          groups[groupName].male += m.days.length;
        } else {
          groups[groupName].female += m.days.length;
        }
      }
    });
    
    return Object.values(groups);
  }, [currentMonthMissions, officials]);

  const officialData = useMemo(() => {
    return currentMonthMissions
      .map(m => {
        const official = officials.find(o => o.id === m.officialId);
        return {
          name: official?.name || 'Unknown',
          days: m.days.length
        };
      })
      .filter(d => d.days > 0)
      .sort((a, b) => b.days - a.days)
      .slice(0, 10);
  }, [currentMonthMissions, officials]);

  const COLORS = [themeHex, '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <motion.div 
          whileHover={{ y: -5 }}
          className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 flex items-center gap-4"
        >
          <div className="w-14 h-14 bg-brand-light dark:bg-brand/10 rounded-2xl flex items-center justify-center">
            <Calendar className="w-8 h-8 text-brand" />
          </div>
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">សរុបថ្ងៃបេសកកម្ម</p>
            <h3 className="text-3xl font-bold text-gray-900 dark:text-white">{totalMissions} ថ្ងៃ</h3>
          </div>
        </motion.div>

        <motion.div 
          whileHover={{ y: -5 }}
          className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 flex items-center gap-4"
        >
          <div className="w-14 h-14 bg-green-50 dark:bg-green-900/10 rounded-2xl flex items-center justify-center">
            <Users className="w-8 h-8 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">មន្ត្រីចុះបេសកកម្ម</p>
            <h3 className="text-3xl font-bold text-gray-900 dark:text-white">{uniqueOfficialsOnMission} នាក់</h3>
          </div>
        </motion.div>

        <motion.div 
          whileHover={{ y: -5 }}
          className="bg-white dark:bg-gray-900 p-6 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 flex items-center gap-4"
        >
          <div className="w-14 h-14 bg-pink-50 dark:bg-pink-900/10 rounded-2xl flex items-center justify-center">
            <UserIcon className="w-8 h-8 text-pink-600 dark:text-pink-400" />
          </div>
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">ចំនួនស្រ្តី</p>
            <h3 className="text-3xl font-bold text-gray-900 dark:text-white">{uniqueWomenOnMission} នាក់</h3>
          </div>
        </motion.div>
      </div>

      {/* Daily Trend Chart */}
      <div className="bg-white dark:bg-gray-900 p-8 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-800">
        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-8 flex items-center gap-2">
          <div className="w-2 h-6 bg-brand rounded-full" />
          និន្នាការបេសកកម្មប្រចាំថ្ងៃ (ខែ{kmMonths[month-1]})
        </h3>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyTrendData}>
                <defs>
                  <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={themeHex} stopOpacity={0.1}/>
                    <stop offset="95%" stopColor={themeHex} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDarkMode ? '#374151' : '#f3f4f6'} />
                <XAxis 
                  dataKey="day" 
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  axisLine={false}
                  tickLine={false}
                  interval={2}
                />
                <YAxis 
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip content={<CustomTooltip />} />
                <Area 
                  type="monotone" 
                  dataKey="count" 
                  name="ចំនួនមន្ត្រី"
                  stroke={themeHex} 
                  strokeWidth={3}
                  fillOpacity={1} 
                  fill="url(#colorCount)" 
                  unit=" នាក់"
                />
              </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

        {/* Charts Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* Missions by Group */}
          <div className="bg-white dark:bg-gray-900 p-8 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-800">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-8 flex items-center gap-2">
              <div className="w-2 h-6 bg-brand rounded-full" />
              បេសកកម្មតាមអង្គភាព
            </h3>
            <div className="h-[350px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={groupData}
                    cx="50%"
                    cy="50%"
                    innerRadius={80}
                    outerRadius={120}
                    paddingAngle={5}
                    dataKey="value"
                    nameKey="name"
                  >
                    {groupData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Gender Breakdown by Group */}
          <div className="bg-white dark:bg-gray-900 p-8 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-800">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-8 flex items-center gap-2">
              <div className="w-2 h-6 bg-brand rounded-full" />
              ការបែងចែកតាមភេទ និងអង្គភាព
            </h3>
            <div className="h-[350px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={genderBreakdownData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDarkMode ? '#374151' : '#f3f4f6'} />
                  <XAxis 
                    dataKey="name" 
                    tick={{ fontSize: 10, fill: '#9ca3af' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis 
                    tick={{ fontSize: 10, fill: '#9ca3af' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" />
                  <Bar dataKey="male" name="ប្រុស" stackId="a" fill={themeHex} radius={[0, 0, 0, 0]} barSize={30} />
                  <Bar dataKey="female" name="ស្រី" stackId="a" fill="#ec4899" radius={[8, 8, 0, 0]} barSize={30} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Top Officials */}
          <div className="bg-white dark:bg-gray-900 p-8 rounded-3xl shadow-sm border border-gray-100 dark:border-gray-800">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-8 flex items-center gap-2">
              <div className="w-2 h-6 bg-brand rounded-full" />
              មន្ត្រីចុះបេសកកម្មច្រើនជាងគេ (Top 10)
            </h3>
            <div className="h-[350px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={officialData} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke={isDarkMode ? '#374151' : '#f3f4f6'} />
                  <XAxis type="number" hide />
                  <YAxis 
                    dataKey="name" 
                    type="category" 
                    width={100} 
                    tick={{ fontSize: 12, fill: '#6b7280' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="days" name="ចំនួនថ្ងៃ" fill="#10b981" radius={[0, 8, 8, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
    </div>
  );
};

const CommitteesTable = ({ 
  committees, 
  onEdit, 
  onDelete, 
  isEditor,
  onViewFile,
  showToast,
  onSharePreview
}: { 
  committees: Committee[], 
  onEdit: (group: Committee[]) => void, 
  onDelete: (ids: string[]) => void,
  isEditor: boolean,
  onViewFile: (url: string) => void,
  showToast: (message: string, type?: 'success' | 'error' | 'info') => void,
  onSharePreview: (group: Committee[]) => void
}) => {
  const groupedCommittees = useMemo(() => {
    const groups: Record<string, Committee[]> = {};
    committees.forEach(c => {
      const key = `${c.leaderName}-${c.leaderPosition}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(c);
    });
    // Sort groups by the latest createdAt in each group
    return Object.values(groups).sort((a, b) => {
      const timeA = Math.max(...a.map(item => new Date(item.createdAt || 0).getTime()));
      const timeB = Math.max(...b.map(item => new Date(item.createdAt || 0).getTime()));
      return timeB - timeA;
    });
  }, [committees]);

  return (
    <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 overflow-hidden">
      <div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-800">
              <th className="p-4 text-center font-semibold text-gray-600 dark:text-gray-400 w-12">ល.រ</th>
              <th className="p-4 text-left font-semibold text-gray-600 dark:text-gray-400 w-48">ឈ្មោះថ្នាក់ដឹកនាំ</th>
              <th className="p-4 text-left font-semibold text-gray-600 dark:text-gray-400">កម្មវត្ថុ</th>
              <th className="p-4 text-left font-semibold text-gray-600 dark:text-gray-400 w-48">ក្រសួង</th>
              <th className="p-4 text-left font-semibold text-gray-600 dark:text-gray-400 w-48">លេខលិខិត</th>
              <th className="p-4 text-center font-semibold text-gray-600 dark:text-gray-400 w-24">ឯកសារ</th>
              <th className="p-4 text-left font-semibold text-gray-600 dark:text-gray-400 w-32">ផ្សេងៗ</th>
              <th className="p-4 text-center font-semibold text-gray-600 dark:text-gray-400 w-16">ចែករំលែក</th>
            </tr>
          </thead>
          <tbody>
            {groupedCommittees.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center text-gray-500 dark:text-gray-400">
                  មិនទាន់មានទិន្នន័យនៅឡើយទេ
                </td>
              </tr>
            ) : (
              groupedCommittees.map((group, gIdx) => (
                <tr 
                  key={group[0].id} 
                  className="border-b-2 border-gray-200 dark:border-gray-700 hover:bg-gray-50/10 dark:hover:bg-gray-800/10 transition-colors group"
                >
                  <td className="p-4 text-center text-gray-500 dark:text-gray-400 align-top border-r border-gray-50 dark:border-gray-800">
                    {gIdx + 1}
                  </td>
                  <td className="p-4 align-top border-r border-gray-50 dark:border-gray-800">
                    <div className="font-bold text-gray-900 dark:text-gray-100">{group[0].leaderName}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{group[0].leaderPosition}</div>
                    {isEditor && (
                      <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity mt-2">
                        <button 
                          onClick={() => onEdit(group)} 
                          className="p-1.5 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg flex items-center gap-1 text-[10px] font-bold border border-blue-100 dark:border-blue-800 w-full justify-center"
                        >
                          <Settings className="w-3 h-3" /> កែសម្រួល
                        </button>
                        <button 
                          onClick={() => onDelete(group.map(item => item.id))} 
                          className="p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg flex items-center gap-1 text-[10px] font-bold border border-red-100 dark:border-red-800 w-full justify-center"
                        >
                          <Trash2 className="w-3 h-3" /> លុប
                        </button>
                      </div>
                    )}
                  </td>
                  <td colSpan={5} className="p-0 align-top">
                    <div className={cn(
                      "overflow-y-auto overflow-x-hidden custom-scrollbar",
                      group.length > 4 ? "max-h-[280px]" : ""
                    )}>
                      <table className="w-full border-collapse">
                        <tbody>
                          {group.map((c, iIdx) => (
                            <tr 
                              key={c.id} 
                              className={cn(
                                "hover:bg-gray-50/30 dark:hover:bg-gray-800/30 transition-colors",
                                iIdx !== group.length - 1 ? "border-b border-gray-100 dark:border-gray-800" : ""
                              )}
                            >
                              <td className="p-4 align-top">
                                <div className="text-gray-700 dark:text-gray-300 flex items-start gap-2">
                                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                                  <span className="whitespace-pre-wrap">{c.objective}</span>
                                </div>
                              </td>
                              <td className="p-4 align-top w-48">
                                <div className="text-gray-700 dark:text-gray-300 flex items-start gap-2">
                                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                                  <span>{c.ministry || '-'}</span>
                                </div>
                              </td>
                              <td className="p-4 align-top w-48">
                                <div className="text-gray-700 dark:text-gray-300 flex items-start gap-2">
                                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" />
                                  <span>{c.documentNumber || '-'}</span>
                                </div>
                              </td>
                              <td className="p-4 align-top text-center w-24">
                                {c.fileUrl ? (
                                  <button 
                                    onClick={() => onViewFile(c.fileUrl!)}
                                    className="p-1.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-lg hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-all inline-block cursor-pointer"
                                    title="មើលឯកសារ"
                                  >
                                    <FileText className="w-4 h-4" />
                                  </button>
                                ) : (
                                  <span className="text-gray-300 dark:text-gray-700">-</span>
                                )}
                              </td>
                              <td className="p-4 align-top w-32">
                                <div className="text-gray-500 dark:text-gray-400 text-xs italic">
                                  {c.notes || '-'}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </td>
                  <td className="p-4 align-top text-center border-l border-gray-50 dark:border-gray-800">
                    <button 
                      onClick={() => onSharePreview(group)}
                      className="p-2 bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400 rounded-xl hover:bg-sky-100 dark:hover:bg-sky-900/50 transition-all inline-flex items-center justify-center cursor-pointer shadow-sm border border-sky-100 dark:border-sky-800"
                      title="មើលគំរូ និងចែករំលែក"
                    >
                      <Share2 className="w-5 h-5" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const SharePreviewModal = ({ 
  group, 
  onClose, 
  showToast 
}: { 
  group: Committee[], 
  onClose: () => void,
  showToast: (msg: string, type?: 'success' | 'error' | 'info') => void
}) => {
  const previewRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const handleShareText = () => {
    let text = `📋 ព័ត៌មានលិខិត/សេចក្តីសម្រេច:\n\n` +
               `👤 ឈ្មោះថ្នាក់ដឹកនាំ: ${group[0].leaderName}\n` +
               `🎖️ តួនាទី: ${group[0].leaderPosition}\n\n`;
    
    group.forEach((item, index) => {
      if (group.length > 1) {
        text += `🔹 ឯកសារទី ${index + 1}:\n`;
      }
      text += `🎯 កម្មវត្ថុ: ${item.objective}\n` +
              `🏛️ ក្រសួង: ${item.ministry || '-'}\n` +
              `📄 លេខលិខិត: ${item.documentNumber || '-'}\n` +
              `📝 ផ្សេងៗ: ${item.notes || '-'}\n\n`;
    });

    const finalBody = text.trim();
    navigator.clipboard.writeText(finalBody).then(() => {
      showToast('បានចម្លងអត្ថបទរួចរាល់', 'success');
      const telegramUrl = `https://t.me/share/url?text=${encodeURIComponent(finalBody)}`;
      window.open(telegramUrl, '_blank');
    });
  };

  const handleExportPDF = async () => {
    if (!previewRef.current) return;
    setIsGenerating(true);
    showToast('កំពុងបង្កើតឯកសារ PDF...', 'info');

    try {
      const canvas = await html2canvas(previewRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff'
      });
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const imgProps = pdf.getImageProperties(imgData);
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (imgProps.height * pdfWidth) / imgProps.width;
      
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`Committee_Share_${group[0].leaderName}.pdf`);
      showToast('បង្កើត PDF ជោគជ័យ', 'success');
    } catch (err) {
      console.error('PDF Error:', err);
      showToast('មានបញ្ហាក្នុងការបង្កើត PDF', 'error');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col"
      >
        <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-gray-50/50 dark:bg-gray-800/50">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-sky-100 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400 rounded-xl">
              <Share2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">មើលគំរូសម្រាប់ចែករំលែក</h3>
              <p className="text-sm text-gray-500 dark:text-gray-400">ពិនិត្យទិន្នន័យមុននឹងផ្ញើចេញ</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-full transition-colors">
            <X className="w-6 h-6 text-gray-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-8">
          <div 
            ref={previewRef}
            className="bg-white border p-10 rounded-xl shadow-sm text-gray-900"
            style={{ 
              fontFamily: "'Inter', sans-serif",
              borderColor: '#e5e7eb',
              backgroundColor: '#ffffff',
              color: '#111827'
            }}
          >
            <div className="text-center mb-8 pb-6" style={{ borderBottom: '2px solid #0ea5e9' }}>
              <h2 className="text-2xl font-bold mb-2" style={{ color: '#0369a1' }}>ព័ត៌មានលិខិត / សេចក្តីសម្រេច</h2>
              <div className="flex items-center justify-center gap-4" style={{ color: '#4b5563' }}>
                <span className="font-bold">ឈ្មោះថ្នាក់ដឹកនាំ: {group[0].leaderName}</span>
                <span className="w-1 h-1 rounded-full" style={{ backgroundColor: '#9ca3af' }} />
                <span>តួនាទី: {group[0].leaderPosition}</span>
              </div>
            </div>

            <table className="w-full border-collapse border" style={{ borderColor: '#d1d5db' }}>
              <thead>
                <tr style={{ backgroundColor: '#f3f4f6' }}>
                  <th className="border p-3 text-center w-12" style={{ borderColor: '#d1d5db' }}>ល.រ</th>
                  <th className="border p-3 text-left" style={{ borderColor: '#d1d5db' }}>នាម និងគោត្តនាម</th>
                  <th className="border p-3 text-left" style={{ borderColor: '#d1d5db' }}>លេខប្រកាស ឬសេចក្តីសម្រេច</th>
                  <th className="border p-3 text-left" style={{ borderColor: '#d1d5db' }}>ក្រុមការងារ ឬគណៈកម្មការ</th>
                  <th className="border p-3 text-left" style={{ borderColor: '#d1d5db' }}>ផ្សេងៗ</th>
                </tr>
              </thead>
              <tbody>
                {group.map((item, idx) => (
                  <tr key={item.id}>
                    <td className="border p-3 text-center" style={{ borderColor: '#d1d5db' }}>{idx + 1}</td>
                    {idx === 0 && (
                      <td rowSpan={group.length} className="border p-3 font-bold align-top" style={{ borderColor: '#d1d5db' }}>
                        {item.leaderName}
                      </td>
                    )}
                    <td className="border p-3" style={{ borderColor: '#d1d5db' }}>{item.documentNumber || '-'}</td>
                    <td className="border p-3" style={{ borderColor: '#d1d5db' }}>{item.objective}</td>
                    <td className="border p-3 text-sm italic" style={{ borderColor: '#d1d5db', color: '#4b5563' }}>{item.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="mt-8 pt-6 border-t text-[10px] flex justify-between" style={{ borderColor: '#f3f4f6', color: '#9ca3af' }}>
              <span>បង្កើតដោយប្រព័ន្ធគ្រប់គ្រងបេសកកម្ម</span>
              <span>កាលបរិច្ឆេទ: {new Date().toLocaleDateString('km-KH')}</span>
            </div>
          </div>
        </div>

        <div className="p-6 border-t border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50 flex items-center justify-end gap-3">
          <button 
            onClick={handleShareText}
            className="px-6 py-2.5 bg-sky-600 hover:bg-sky-700 text-white rounded-xl font-bold transition-all flex items-center gap-2 shadow-lg shadow-sky-200 dark:shadow-none"
          >
            <Share2 className="w-5 h-5" /> ចែករំលែកជាអត្ថបទ
          </button>
          <button 
            onClick={handleExportPDF}
            disabled={isGenerating}
            className="px-6 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold transition-all flex items-center gap-2 shadow-lg shadow-emerald-200 dark:shadow-none disabled:opacity-50"
          >
            {isGenerating ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileDown className="w-5 h-5" />}
            ទាញយកជា PDF
          </button>
        </div>
      </motion.div>
    </div>
  );
};

interface CommitteeRow {
  id: string;
  objective: string;
  ministry: string;
  documentNumber: string;
  notes: string;
  file: File | null;
  fileUrl?: string;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [appUser, setAppUser] = useState<AppUser | null>(null);
  const [allUsers, setAllUsers] = useState<AppUser[]>([]);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const [isManagingGroups, setIsManagingGroups] = useState(false);
  const [newGroupName, setNewGroupName] = useState('');
  const [editingGroup, setEditingGroup] = useState<Group | null>(null);
  const [isManagingUsers, setIsManagingUsers] = useState(false);
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserRole, setNewUserRole] = useState<'admin' | 'editor' | 'viewer'>('viewer');
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [officials, setOfficials] = useState<Official[]>([]);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [isAddingOfficial, setIsAddingOfficial] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importText, setImportText] = useState('');
  const [importGroup, setImportGroup] = useState('General Affairs');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [editingNote, setEditingNote] = useState<{ officialId: string, day: number, text: string } | null>(null);
  const [isBulkEditing, setIsBulkEditing] = useState(false);
  const [bulkNoteText, setBulkNoteText] = useState('');
  const [selectedOfficialIds, setSelectedOfficialIds] = useState<string[]>([]);
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [editingOfficial, setEditingOfficial] = useState<Official | null>(null);
  const [newOfficial, setNewOfficial] = useState<Partial<Official>>({
    name: '',
    position: '',
    group: 'General Affairs',
    groupDescription: '',
    gender: 'M'
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'table' | 'calendar' | 'dashboard'>('table');
  const [mainView, setMainView] = useState<'missions' | 'committees'>('missions');
  const [sharePreviewGroup, setSharePreviewGroup] = useState<Committee[] | null>(null);
  const [activeTab, setActiveTab] = useState<'all' | 'leadership' | 'officials'>('all');
  const [committees, setCommittees] = useState<Committee[]>([]);
  const [isAddingCommittee, setIsAddingCommittee] = useState(false);
  const [editingCommittee, setEditingCommittee] = useState<Committee | null>(null);
  const [newCommittee, setNewCommittee] = useState<Partial<Committee>>({
    leaderName: '',
    leaderPosition: '',
    documentNumber: '',
    objective: '',
    ministry: '',
    fileUrl: '',
    notes: ''
  });
  const [committeeRows, setCommitteeRows] = useState<CommitteeRow[]>([
    { id: Math.random().toString(36).substr(2, 9), objective: '', ministry: '', documentNumber: '', notes: '', file: null }
  ]);
  const [isUploadingCommitteeFile, setIsUploadingCommitteeFile] = useState(false);
  const [filterDateRange, setFilterDateRange] = useState<{ start: number | null, end: number | null }>({ start: null, end: null });
  const [showReminders, setShowReminders] = useState(false);
  const [deletingOfficialId, setDeletingOfficialId] = useState<string | null>(null);
  const [deletingGroupId, setDeletingGroupId] = useState<string | null>(null);
  const [isPreviewingExport, setIsPreviewingExport] = useState(false);
  const [exportConfig, setExportConfig] = useState({
    columns: {
      name: true,
      position: true,
      group: true,
      gender: true,
      days: true
    },
    selectedGroups: [] as string[],
    onlyWithMissions: false
  });
  const [theme, setTheme] = useState<'blue' | 'slate' | 'emerald' | 'indigo' | 'rose'>(
    (localStorage.getItem('app-theme') as any) || 'blue'
  );
  const [isDarkMode, setIsDarkMode] = useState<boolean>(
    localStorage.getItem('app-dark-mode') === 'true'
  );

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('app-theme', theme);
  }, [theme]);

  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('app-dark-mode', String(isDarkMode));
  }, [isDarkMode]);

  const [error, setError] = useState<string | null>(null);

  const [isSavingNote, setIsSavingNote] = useState(false);
  const [isDeletingMission, setIsDeletingMission] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
    setToast({ message, type });
    if (type !== 'info') {
      setTimeout(() => setToast(null), 3000);
    }
  };

  const uploadFileToFirestore = async (file: File): Promise<string> => {
    const CHUNK_SIZE = 500 * 1024; // 500KB chunks
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    
    console.log(`Uploading to Firestore in ${totalChunks} chunks: ${file.name}`);

    const fileMetadata: any = {
      name: file.name,
      type: file.type,
      size: file.size,
      totalChunks: totalChunks,
      createdAt: new Date().toISOString()
    };

    // If file is small enough, store in a single doc for efficiency
    if (totalChunks <= 1) {
      const base64Data = await fileToBase64(file);
      fileMetadata.data = base64Data;
      const docRef = await addDoc(collection(db, 'files'), fileMetadata);
      return `firestore://${docRef.id}`;
    }

    // For larger files, create metadata doc first
    const docRef = await addDoc(collection(db, 'files'), fileMetadata);
    const fileId = docRef.id;

    // Upload chunks
    const base64Full = await fileToBase64(file);
    for (let i = 0; i < totalChunks; i++) {
      const start = i * (base64Full.length / totalChunks);
      const end = (i + 1) * (base64Full.length / totalChunks);
      const chunkData = base64Full.substring(start, end);
      
      await addDoc(collection(db, 'file_chunks'), {
        fileId: fileId,
        chunkIndex: i,
        data: chunkData
      });
      console.log(`Uploaded chunk ${i + 1}/${totalChunks}`);
    }

    return `firestore://${fileId}`;
  };

  const uploadFileWithFallback = async (file: File, index: number): Promise<string> => {
    let fileToProcess = file;
    
    // Auto-compress if it's a large image
    if (file.type.startsWith('image/') && file.size > 750 * 1024) {
      try {
        fileToProcess = await compressImage(file);
      } catch (e) {
        console.warn('Compression failed, using original file', e);
      }
    }

    try {
      console.log(`Attempting Storage upload for row ${index}: ${fileToProcess.name}`);
      const sanitizedName = fileToProcess.name.replace(/[^a-zA-Z0-9.]/g, '_');
      const fileRef = ref(storage, `committees/${Date.now()}_${index}_${sanitizedName}`);
      
      const uploadTask = uploadBytesResumable(fileRef, fileToProcess);
      
      return await new Promise((resolve, reject) => {
        uploadTask.on('state_changed', 
          (snapshot) => {
            const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
            console.log(`Storage upload is ${progress}% done`);
          }, 
          (error) => {
            console.warn('Storage upload failed, will try Firestore fallback:', error);
            reject(error);
          }, 
          async () => {
            const downloadURL = await getDownloadURL(uploadTask.snapshot.ref);
            resolve(downloadURL);
          }
        );
        
        // Increased timeout for Storage to 90 seconds
        setTimeout(() => reject(new Error('Storage Timeout')), 90000);
      });
    } catch (err) {
      console.log(`Storage failed or timed out, switching to Firestore fallback for row ${index}`);
      try {
        return await uploadFileToFirestore(fileToProcess);
      } catch (firestoreErr) {
        console.error(`Firestore upload also failed for row ${index}:`, firestoreErr);
        let errorMsg = `មិនអាចបញ្ជូនឯកសារបានទេ៖ ${firestoreErr instanceof Error ? firestoreErr.message : 'បញ្ហាបច្ចេកទេស'}`;
        
        if (fileToProcess.size > 800 * 1024) {
          if (fileToProcess.type.includes('pdf')) {
            errorMsg = `ឯកសារ PDF ធំពេក (${(fileToProcess.size / 1024).toFixed(0)}KB)។ ដោយសារប្រព័ន្ធផ្ទុកឯកសារចម្បងមានបញ្ហា ប្រព័ន្ធបម្រុងមិនអាចទទួលយក PDF ធំជាង 750KB បានទេ។ សូមព្យាយាមបង្រួម PDF នោះជាមុនសិន។`;
          } else {
            errorMsg = `ឯកសារនៅតែធំពេក (${(fileToProcess.size / 1024).toFixed(0)}KB) បន្ទាប់ពីបង្រួម។ សូមព្យាយាមប្រើរូបភាពតូចជាងនេះ។`;
          }
        }
        throw new Error(errorMsg);
      }
    }
  };

  const handleViewFile = async (fileUrl: string) => {
    if (!fileUrl) return;

    if (fileUrl.startsWith('firestore://')) {
      const fileId = fileUrl.replace('firestore://', '');
      try {
        showToast('កំពុងទាញយកឯកសារ...', 'info');
        const fileDoc = await getDoc(doc(db, 'files', fileId));
        
        if (fileDoc.exists()) {
          const metadata = fileDoc.data() as FileStorage;
          let fullBase64 = '';

          if (metadata.totalChunks && metadata.totalChunks > 1) {
            // Fetch all chunks
            const chunksQuery = query(
              collection(db, 'file_chunks'), 
              where('fileId', '==', fileId),
              orderBy('chunkIndex', 'asc')
            );
            const chunksSnapshot = await getDocs(chunksQuery);
            const chunks = chunksSnapshot.docs.map(d => d.data() as FileChunk);
            
            // Reassemble
            fullBase64 = chunks.map(c => c.data).join('');
          } else {
            fullBase64 = metadata.data || '';
          }

          if (!fullBase64) {
            throw new Error('រកមិនឃើញទិន្នន័យឯកសារ');
          }

          const byteCharacters = atob(fullBase64);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: metadata.type });
          const url = URL.createObjectURL(blob);
          window.open(url, '_blank');
        } else {
          showToast('រកមិនឃើញឯកសារក្នុងប្រព័ន្ធទេ', 'error');
        }
      } catch (err) {
        console.error('Error fetching file from Firestore:', err);
        showToast('មានបញ្ហាក្នុងការទាញយកឯកសារ', 'error');
      }
    } else {
      window.open(fileUrl, '_blank');
    }
  };

  const isAdmin = useMemo(() => {
    return appUser?.role === 'admin' || user?.email === 'lasediii.info@gmail.com';
  }, [appUser, user]);

  const isEditor = useMemo(() => {
    return isAdmin || appUser?.role === 'editor';
  }, [isAdmin, appUser]);

  const reminders = useMemo(() => {
    const list: { id: string; type: string; officialName: string; message: string; severity: 'info' | 'warning' | 'error' }[] = [];
    const now = new Date();
    const today = startOfDay(now);
    const viewingYear = getYear(currentDate);
    const viewingMonth = getMonth(currentDate);
    const isViewingCurrentMonth = isSameMonth(currentDate, now);

    officials.forEach(official => {
      const month = getMonth(currentDate) + 1;
      const year = getYear(currentDate);
      const mission = missions.find(m => m.officialId === official.id && m.month === month && m.year === year);
      const daysCount = mission?.days.length || 0;

      // 1. Nearly 10 days (8 or 9) - Show for any month being viewed
      if (daysCount >= 8 && daysCount < 10) {
        list.push({
          id: `nearly-10-${official.id}-${viewingMonth}-${viewingYear}`,
          type: 'nearly-10',
          officialName: official.name,
          message: `ជិតដល់ ១០ ថ្ងៃហើយ (បច្ចុប្បន្ន ${daysCount} ថ្ងៃ)`,
          severity: 'warning'
        });
      }

      // 2. More than 10 days - Show for any month being viewed
      if (daysCount >= 10) {
        list.push({
          id: `more-10-${official.id}-${viewingMonth}-${viewingYear}`,
          type: 'more-10',
          officialName: official.name,
          message: `លើសពី ១០ ថ្ងៃហើយ (បច្ចុប្បន្ន ${daysCount} ថ្ងៃ)`,
          severity: 'error'
        });
      }

      // The following only apply to the ACTUAL current month
      if (isViewingCurrentMonth) {
        // 3. No status logged - Only after day 5 of the month to avoid noise
        if (daysCount === 0 && now.getDate() > 5) {
          list.push({
            id: `no-status-${official.id}`,
            type: 'no-status',
            officialName: official.name,
            message: 'មិនទាន់មានការចុះបេសកកម្មនៅខែនេះទេ',
            severity: 'info'
          });
        }

        // 4. Upcoming missions (next 3 days)
        if (mission) {
          mission.days.forEach(day => {
            const missionDate = new Date(viewingYear, viewingMonth, day);
            const diffDays = differenceInCalendarDays(missionDate, today);
            
            if (diffDays >= 0 && diffDays <= 3) {
              list.push({
                id: `upcoming-${official.id}-${day}`,
                type: 'upcoming',
                officialName: official.name,
                message: `មានបេសកកម្មនៅថ្ងៃទី ${day} (${diffDays === 0 ? 'ថ្ងៃនេះ' : 'ក្នុងរយៈពេល ' + diffDays + ' ថ្ងៃទៀត'})`,
                severity: 'info'
              });
            }
          });
        }
      }
    });

    return list;
  }, [officials, missions, currentDate]);

  // --- Auth ---

  useEffect(() => {
    let unsubscribeUser: (() => void) | undefined;

    const unsubscribeAuth = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      
      if (unsubscribeUser) {
        unsubscribeUser();
        unsubscribeUser = undefined;
      }

      if (u) {
        const userDocRef = doc(db, 'users', u.uid);
        unsubscribeUser = onSnapshot(userDocRef, async (snapshot) => {
          if (snapshot.exists()) {
            setAppUser(snapshot.data() as AppUser);
          } else {
            const newUser: AppUser = {
              uid: u.uid,
              email: u.email || '',
              displayName: u.displayName || '',
              photoURL: u.photoURL || '',
              role: u.email === 'lasediii.info@gmail.com' ? 'admin' : 'viewer'
            };
            try {
              await setDoc(userDocRef, newUser);
              setAppUser(newUser);
            } catch (err) {
              console.error('Error creating user profile:', err);
            }
          }
          setIsAuthReady(true);
        }, (err) => {
          console.error('User profile snapshot error:', err);
          setIsAuthReady(true);
        });
      } else {
        setAppUser(null);
        setIsAuthReady(true);
      }
    });

    return () => {
      unsubscribeAuth();
      if (unsubscribeUser) unsubscribeUser();
    };
  }, []);

  const handleLogin = async () => {
    setAuthError(null);
    setIsAuthLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      console.error('Login error:', err);
      setAuthError('ការចូលប្រើប្រាស់បរាជ័យ។ សូមព្យាយាមម្តងទៀត។');
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsAuthLoading(true);
    try {
      await signInWithEmailAndPassword(auth, loginEmail, loginPassword);
    } catch (err: any) {
      console.error('Email login error:', err);
      const errorCode = err.code;
      
      if (errorCode === 'auth/user-not-found' || errorCode === 'auth/wrong-password' || errorCode === 'auth/invalid-credential') {
        setAuthError('អ៊ីមែល ឬពាក្យសម្ងាត់មិនត្រឹមត្រូវ។ សូមពិនិត្យមើលម្ដងទៀត។');
      } else if (errorCode === 'auth/invalid-email') {
        setAuthError('ទម្រង់អ៊ីមែលមិនត្រឹមត្រូវ។');
      } else if (errorCode === 'auth/user-disabled') {
        setAuthError('គណនីនេះត្រូវបានបិទ។');
      } else if (errorCode === 'auth/too-many-requests') {
        setAuthError('ការចូលប្រើប្រាស់ត្រូវបានរារាំងជាបណ្តោះអាសន្ន ដោយសារការប៉ុនប៉ងបរាជ័យច្រើនដង។ សូមព្យាយាមម្តងទៀតនៅពេលក្រោយ។');
      } else {
        setAuthError('មានបញ្ហាក្នុងការចូលប្រើប្រាស់។ សូមព្យាយាមម្តងទៀត។');
      }
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    setIsAuthLoading(true);
    console.log('Starting user creation process...');
    
    try {
      // Use secondaryAuth to create user without signing out the current admin
      console.log('Creating auth user in secondary app...');
      const userCredential = await createUserWithEmailAndPassword(secondaryAuth, newUserEmail, newUserPassword);
      const newUser = userCredential.user;
      console.log('Auth user created successfully:', newUser.uid);

      // Update profile with name
      console.log('Updating user profile...');
      await updateProfile(newUser, { displayName: newUserName });

      // Create user document in Firestore
      console.log('Creating user document in Firestore...');
      const userDocRef = doc(db, 'users', newUser.uid);
      const appUserData: AppUser = {
        uid: newUser.uid,
        email: newUserEmail,
        displayName: newUserName,
        photoURL: `https://ui-avatars.com/api/?name=${encodeURIComponent(newUserName)}&background=random`,
        role: newUserRole
      };
      await setDoc(userDocRef, appUserData);
      console.log('User document created successfully');

      // Reset form and close modal
      setNewUserEmail('');
      setNewUserPassword('');
      setNewUserName('');
      setNewUserRole('viewer');
      setIsCreatingUser(false);
      
      // Sign out from secondary app to keep it clean
      await secondaryAuth.signOut();
      console.log('Secondary auth signed out');
    } catch (err: any) {
      console.error('Detailed create user error:', err);
      const errorCode = err.code;
      const errorMessage = err.message;
      
      if (errorCode === 'auth/email-already-in-use') {
        setAuthError('អ៊ីមែលនេះត្រូវបានប្រើប្រាស់រួចហើយ។');
      } else if (errorCode === 'auth/weak-password') {
        setAuthError('ពាក្យសម្ងាត់ត្រូវមានយ៉ាងហោចណាស់ ៦ តួអក្សរ។');
      } else if (errorCode === 'auth/operation-not-allowed') {
        setAuthError('សូមបើកដំណើរការ "Email/Password" នៅក្នុង Firebase Console (Authentication > Sign-in method)។');
      } else if (errorCode === 'auth/network-request-failed') {
        setAuthError('បញ្ហាបណ្តាញអ៊ីនធឺណិត។ សូមពិនិត្យមើលការភ្ជាប់របស់អ្នក។');
      } else {
        setAuthError(`មានបញ្ហាក្នុងការបង្កើតអ្នកប្រើប្រាស់៖ ${errorMessage}`);
      }
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  // --- Data Fetching ---

  useEffect(() => {
    if (!user || !isAuthReady) return;

    // Clear missions when month/year changes to avoid stale data issues
    setMissions([]);
    setOfficials([]);

    const groupsQuery = query(collection(db, 'groups'), orderBy('order', 'asc'));
    const unsubscribeGroups = onSnapshot(groupsQuery, async (snapshot) => {
      if (snapshot.empty && isAdmin) {
        // Seed initial groups if empty
        const initialGroups = [
          { name: 'នាយកដ្ឋានរដ្ឋបាល', order: 0 },
          { name: 'ថ្នាក់ដឹកនាំ', order: 1 },
          { name: 'ក្រុមបច្ចេកទេស', order: 2 },
          { name: 'ការិយាល័យរដ្ឋបាល', order: 3 },
          { name: 'ការិយាល័យបុគ្គលិក', order: 4 },
          { name: 'ការិយាល័យពិធីការ', order: 5 },
          { name: 'ការិយាល័យតម្កល់ឯកសារ', order: 6 },
          { name: 'ការិយាល័យសន្តិសុខ', order: 7 },
          { name: 'មន្ត្រីជាប់កិច្ចសន្យា បម្រើការងារសណ្ដាប់ធ្នាប់ និងពិធីការ', order: 8 }
        ];
        for (const g of initialGroups) {
          await addDoc(collection(db, 'groups'), g);
        }
      } else {
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Group));
        
        // Filter out duplicates by name (case-insensitive, trimmed)
        const uniqueGroups: Group[] = [];
        const seenNames = new Set<string>();
        const duplicateIds: string[] = [];

        data.forEach(group => {
          const normalizedName = group.name.trim().toLowerCase();
          if (seenNames.has(normalizedName)) {
            duplicateIds.push(group.id);
          } else {
            seenNames.add(normalizedName);
            uniqueGroups.push(group);
          }
        });

        // Automatically clean up duplicates in the background if admin
        if (duplicateIds.length > 0 && isAdmin) {
          console.log(`Cleaning up ${duplicateIds.length} duplicate groups...`);
          Promise.all(duplicateIds.map(id => deleteDoc(doc(db, 'groups', id))))
            .catch(err => console.error('Error cleaning up duplicate groups:', err));
        }

        setGroups(uniqueGroups);
        
        // Update default group for new official if groups are loaded
        if (uniqueGroups.length > 0) {
          if (!newOfficial.group) setNewOfficial(prev => ({ ...prev, group: uniqueGroups[0].name }));
          if (importGroup === 'General Affairs') setImportGroup(uniqueGroups[0].name);
        }
      }
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'groups'));

    const officialsQuery = query(collection(db, 'officials'), orderBy('order', 'asc'));
    const unsubscribeOfficials = onSnapshot(officialsQuery, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Official));
      setOfficials(data);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'officials'));

    const month = getMonth(currentDate) + 1;
    const year = getYear(currentDate);
    const missionsQuery = query(
      collection(db, 'missions'), 
      where('month', '==', month),
      where('year', '==', year)
    );
    const unsubscribeMissions = onSnapshot(missionsQuery, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Mission));
      setMissions(data);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'missions'));

    const committeesQuery = query(collection(db, 'committees'), orderBy('order', 'asc'));
    const unsubscribeCommittees = onSnapshot(committeesQuery, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Committee));
      setCommittees(data);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'committees'));

    setFilterDateRange({ start: null, end: null });

    let unsubscribeAllUsers: (() => void) | undefined;
    if (isAdmin) {
      const usersQuery = query(collection(db, 'users'), orderBy('email', 'asc'));
      unsubscribeAllUsers = onSnapshot(usersQuery, (snapshot) => {
        const data = snapshot.docs.map(doc => ({ ...doc.data() } as AppUser));
        setAllUsers(data);
      }, (err) => handleFirestoreError(err, OperationType.LIST, 'users'));
    }

    return () => {
      unsubscribeGroups();
      unsubscribeOfficials();
      unsubscribeMissions();
      unsubscribeCommittees();
      if (unsubscribeAllUsers) unsubscribeAllUsers();
    };
  }, [user, isAuthReady, currentDate, isAdmin]);

  // --- Actions ---

  const handleAddGroup = async () => {
    if (!isAdmin || !newGroupName.trim()) return;
    
    // Check for duplicates
    const isDuplicate = groups.some(g => g.name.toLowerCase() === newGroupName.trim().toLowerCase());
    if (isDuplicate) {
      showToast('ឈ្មោះក្រុមនេះមានរួចហើយ', 'error');
      return;
    }

    try {
      await addDoc(collection(db, 'groups'), {
        name: newGroupName.trim(),
        order: groups.length
      });
      setNewGroupName('');
      showToast('បានបន្ថែមក្រុមថ្មីដោយជោគជ័យ');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'groups');
    }
  };

  const handleEditGroup = async () => {
    if (!isAdmin || !editingGroup || !newGroupName.trim()) return;

    // Check for duplicates (excluding current group)
    const isDuplicate = groups.some(g => g.id !== editingGroup.id && g.name.toLowerCase() === newGroupName.trim().toLowerCase());
    if (isDuplicate) {
      showToast('ឈ្មោះក្រុមនេះមានរួចហើយ', 'error');
      return;
    }

    try {
      await updateDoc(doc(db, 'groups', editingGroup.id), {
        name: newGroupName.trim()
      });
      setEditingGroup(null);
      setNewGroupName('');
      showToast('បានកែសម្រួលក្រុមដោយជោគជ័យ');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'groups');
    }
  };

  const handleDeleteGroup = async (id: string) => {
    if (!isAdmin) return;
    try {
      await deleteDoc(doc(db, 'groups', id));
      setDeletingGroupId(null);
      showToast('បានលុបក្រុមដោយជោគជ័យ');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'groups');
    }
  };

  const handleUpdateGroupOrder = async (id: string, newOrder: number) => {
    if (!isAdmin) return;
    try {
      await updateDoc(doc(db, 'groups', id), {
        order: newOrder
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'groups');
    }
  };

  const handleAddCommittee = async () => {
    if (!isEditor) return;
    if (!newCommittee.leaderName || !newCommittee.leaderPosition) {
      showToast('សូមបញ្ចូលឈ្មោះ និងតួនាទីថ្នាក់ដឹកនាំ', 'error');
      return;
    }
    
    const validRows = committeeRows.filter(row => row.objective.trim() !== '');
    if (validRows.length === 0) {
      showToast('សូមបញ្ចូលកម្មវត្ថុយ៉ាងហោចណាស់មួយ', 'error');
      return;
    }

    setIsUploadingCommitteeFile(true);
    showToast('កំពុងបង្រួម និងរក្សាទុកទិន្នន័យ...', 'info');
    
    try {
      console.log('Starting handleAddCommittee...');
      const batch = writeBatch(db);
      const baseOrder = committees.length;

      // Process all rows in parallel
      await Promise.all(validRows.map(async (row, index) => {
        let fileUrl = '';
        if (row.file) {
          fileUrl = await uploadFileWithFallback(row.file, index);
        }

        const newDocRef = doc(collection(db, 'committees'));
        batch.set(newDocRef, {
          leaderName: newCommittee.leaderName,
          leaderPosition: newCommittee.leaderPosition,
          objective: row.objective,
          ministry: row.ministry,
          documentNumber: row.documentNumber,
          notes: row.notes,
          fileUrl: fileUrl,
          order: baseOrder + index,
          createdAt: new Date().toISOString()
        });
      }));

      console.log('Committing batch for handleAddCommittee...');
      await batch.commit();
      console.log('Batch committed successfully.');

      setNewCommittee({ 
        leaderName: '',
        leaderPosition: '',
        documentNumber: '', 
        objective: '', 
        ministry: '',
        fileUrl: '',
        notes: ''
      });
      setCommitteeRows([{ id: Math.random().toString(36).substr(2, 9), objective: '', ministry: '', documentNumber: '', notes: '', file: null }]);
      setIsAddingCommittee(false);
      showToast('បានបន្ថែមព័ត៌មានថ្មីដោយជោគជ័យ');
    } catch (err) {
      console.error('Error adding committee:', err);
      showToast('មានបញ្ហាក្នុងការរក្សាទុក៖ ' + (err instanceof Error ? err.message : String(err)), 'error');
      handleFirestoreError(err, OperationType.WRITE, 'committees');
    } finally {
      setIsUploadingCommitteeFile(false);
    }
  };

  const handleEditCommittee = async () => {
    if (!isEditor || !editingCommittee) return;
    if (!editingCommittee.leaderName || !editingCommittee.leaderPosition) {
      showToast('សូមបញ្ចូលឈ្មោះ និងតួនាទីថ្នាក់ដឹកនាំ', 'error');
      return;
    }

    const validRows = committeeRows.filter(row => row.objective.trim() !== '');
    if (validRows.length === 0) {
      showToast('សូមបញ្ចូលកម្មវត្ថុយ៉ាងហោចណាស់មួយ', 'error');
      return;
    }

    setIsUploadingCommitteeFile(true);
    showToast('កំពុងបង្រួម និងរក្សាទុកការកែសម្រួល...', 'info');

    try {
      console.log('Starting handleEditCommittee...');
      const batch = writeBatch(db);
      
      // Find rows to delete (those that were in the original group but are not in the current validRows)
      const originalGroup = committees.filter(c => 
        c.leaderName === editingCommittee.leaderName && 
        c.leaderPosition === editingCommittee.leaderPosition
      );
      const remainingIds = validRows.map(r => r.id);
      const idsToDelete = originalGroup.filter(c => !remainingIds.includes(c.id)).map(c => c.id);
      
      idsToDelete.forEach(id => {
        console.log(`Deleting removed row: ${id}`);
        batch.delete(doc(db, 'committees', id));
      });

      await Promise.all(validRows.map(async (row, index) => {
        let fileUrl = row.fileUrl || '';
        const fileToUpload = row.file;
        
        if (fileToUpload) {
          fileUrl = await uploadFileWithFallback(fileToUpload, index);
        }

        const existingDoc = committees.find(c => c.id === row.id);
        if (existingDoc) {
          console.log(`Updating existing doc: ${row.id}`);
          const docRef = doc(db, 'committees', row.id);
          batch.update(docRef, {
            leaderName: editingCommittee.leaderName,
            leaderPosition: editingCommittee.leaderPosition,
            objective: row.objective,
            ministry: row.ministry,
            documentNumber: row.documentNumber,
            notes: row.notes,
            fileUrl: fileUrl
          });
        } else {
          console.log('Creating new doc for additional row');
          const newDocRef = doc(collection(db, 'committees'));
          batch.set(newDocRef, {
            leaderName: editingCommittee.leaderName,
            leaderPosition: editingCommittee.leaderPosition,
            objective: row.objective,
            ministry: row.ministry,
            documentNumber: row.documentNumber,
            notes: row.notes,
            fileUrl: fileUrl,
            order: committees.length + index,
            createdAt: new Date().toISOString()
          });
        }
      }));

      console.log('Committing batch for handleEditCommittee...');
      await batch.commit();
      console.log('Batch committed successfully.');

      setEditingCommittee(null);
      setCommitteeRows([{ id: Math.random().toString(36).substr(2, 9), objective: '', ministry: '', documentNumber: '', notes: '', file: null }]);
      setIsAddingCommittee(false);
      showToast('បានកែសម្រួលព័ត៌មានដោយជោគជ័យ');
    } catch (err) {
      console.error('Error editing committee:', err);
      showToast('មានបញ្ហាក្នុងការរក្សាទុក៖ ' + (err instanceof Error ? err.message : String(err)), 'error');
      handleFirestoreError(err, OperationType.WRITE, 'committees');
    } finally {
      setIsUploadingCommitteeFile(false);
    }
  };

  const handleDeleteCommittee = async (ids: string | string[]) => {
    if (!isEditor) return;
    const idList = Array.isArray(ids) ? ids : [ids];
    if (!window.confirm('តើអ្នកប្រាកដជាចង់លុបព័ត៌មាននេះមែនទេ?')) return;
    
    try {
      const batch = writeBatch(db);
      idList.forEach(id => {
        batch.delete(doc(db, 'committees', id));
      });
      await batch.commit();
      showToast('បានលុបព័ត៌មានដោយជោគជ័យ');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'committees');
    }
  };

  const handleAddOfficial = async () => {
    if (!isEditor) return;
    if (!newOfficial.name || !newOfficial.position || !newOfficial.group) {
      setError('Please fill in all required fields.');
      return;
    }

    try {
      await addDoc(collection(db, 'officials'), {
        ...newOfficial,
        order: officials.length
      });
      setNewOfficial({ name: '', position: '', group: 'General Affairs', groupDescription: '', gender: 'M' });
      setIsAddingOfficial(false);
      setError(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'officials');
    }
  };

  const handleBulkImport = async () => {
    if (!isEditor) return;
    let newOfficials: Partial<Official>[] = [];

    if (importFile) {
      try {
        const data = await importFile.arrayBuffer();
        const workbook = XLSX.read(data);
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][];

        // Skip header row if it exists
        const startRow = jsonData[0]?.[0] === 'ល.រ' || isNaN(Number(jsonData[0]?.[0])) ? 1 : 0;

        for (let i = startRow; i < jsonData.length; i++) {
          const row = jsonData[i];
          const name = row[1]?.toString().trim();
          const gender = row[2]?.toString().trim();
          const position = row[3]?.toString().trim();

          if (name && position) {
            newOfficials.push({
              name,
              position,
              group: importGroup,
              gender: gender === 'ប' ? 'M' : gender === 'ស' ? 'F' : (gender as any) || 'M',
            });
          }
        }
      } catch (err) {
        console.error('Excel parse error:', err);
        setError('Failed to parse Excel file.');
        return;
      }
    } else if (importText.trim()) {
      const lines = importText.split('\n').filter(line => line.trim());
      for (const line of lines) {
        const [name, position, group, gender] = line.split(',').map(s => s.trim());
        if (name && position) {
          newOfficials.push({
            name,
            position,
            group: group || importGroup,
            gender: (gender as any) || 'M',
          });
        }
      }
    } else {
      setError('Please enter data or upload an Excel file.');
      return;
    }

    if (newOfficials.length === 0) {
      setError('No valid data found. Format: Name, Position, Group, Gender');
      return;
    }

    try {
      let currentOrder = officials.length;
      for (const off of newOfficials) {
        await addDoc(collection(db, 'officials'), {
          ...off,
          order: currentOrder++
        });
      }
      setImportText('');
      setImportFile(null);
      setIsImporting(false);
      setError(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'officials');
    }
  };

  const handleDeleteOfficial = async (id: string) => {
    if (!isEditor) return;
    try {
      await deleteDoc(doc(db, 'officials', id));
      // Also delete related missions
      const q = query(collection(db, 'missions'), where('officialId', '==', id));
      const snapshot = await getDocs(q);
      const deletePromises = snapshot.docs.map((d) => deleteDoc(doc(db, 'missions', d.id)));
      await Promise.all(deletePromises);
      setDeletingOfficialId(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'officials');
    }
  };

  const toggleMissionDay = async (officialId: string, day: number) => {
    if (!isEditor) return;

    const month = getMonth(currentDate) + 1;
    const year = getYear(currentDate);
    const missionId = `${officialId}_${month}_${year}`;
    const matchingMissions = missions.filter(m => m.officialId === officialId && m.month === month && m.year === year);
    const existingMission = matchingMissions.find(m => m.id === missionId) || matchingMissions[0];

    try {
      if (existingMission) {
        // Merge all duplicates first if any
        const allDays = Array.from(new Set(matchingMissions.flatMap(m => m.days || [])));
        const allNotes = matchingMissions.reduce((acc, m) => ({ ...acc, ...(m.notes || {}) }), {} as Record<string, string>);
        
        const newDays = allDays.includes(day)
          ? allDays.filter(d => d !== day)
          : [...allDays, day];
        
        await setDoc(doc(db, 'missions', missionId), {
          id: missionId,
          officialId,
          month,
          year,
          days: newDays,
          notes: allNotes
        });

        // Delete other duplicates
        for (const m of matchingMissions) {
          if (m.id !== missionId) {
            await deleteDoc(doc(db, 'missions', m.id));
          }
        }
      } else {
        await setDoc(doc(db, 'missions', missionId), {
          id: missionId,
          officialId,
          month,
          year,
          days: [day],
          notes: {}
        });
      }
      showToast('បានធ្វើបច្ចុប្បន្នភាពបេសកកម្ម');
    } catch (err) {
      showToast('បរាជ័យក្នុងការធ្វើបច្ចុប្បន្នភាព', 'error');
      handleFirestoreError(err, OperationType.WRITE, 'missions');
    }
  };

  const deleteMissionDay = async (officialId: string, day: number) => {
    if (!isEditor) return;

    const month = getMonth(currentDate) + 1;
    const year = getYear(currentDate);
    const missionId = `${officialId}_${month}_${year}`;
    const matchingMissions = missions.filter(m => m.officialId === officialId && m.month === month && m.year === year);
    
    if (matchingMissions.length === 0) return;

    try {
      setIsDeletingMission(true);
      
      // Merge all duplicates first
      const allDays = Array.from(new Set(matchingMissions.flatMap(m => m.days || [])));
      const allNotes = matchingMissions.reduce((acc, m) => ({ ...acc, ...(m.notes || {}) }), {} as Record<string, string>);

      const newDays = allDays.filter(d => d !== day);
      const newNotes = { ...allNotes };
      delete newNotes[day.toString()];

      if (newDays.length === 0) {
        // Delete ALL matching documents
        for (const m of matchingMissions) {
          await deleteDoc(doc(db, 'missions', m.id));
        }
        // Also ensure deterministic ID is gone
        await deleteDoc(doc(db, 'missions', missionId));
      } else {
        // Update/Create deterministic document
        await setDoc(doc(db, 'missions', missionId), {
          id: missionId,
          officialId,
          month,
          year,
          days: newDays,
          notes: newNotes
        });

        // Delete other duplicates
        for (const m of matchingMissions) {
          if (m.id !== missionId) {
            await deleteDoc(doc(db, 'missions', m.id));
          }
        }
      }
      showToast('លុបបេសកកម្មបានជោគជ័យ');
      setEditingNote(null);
    } catch (err) {
      showToast('បរាជ័យក្នុងការលុបបេសកកម្ម', 'error');
      handleFirestoreError(err, OperationType.DELETE, 'missions');
    } finally {
      setIsDeletingMission(false);
    }
  };

  const updateMissionNote = async () => {
    if (!editingNote || !isEditor) return;

    const month = getMonth(currentDate) + 1;
    const year = getYear(currentDate);
    const missionId = `${editingNote.officialId}_${month}_${year}`;
    const matchingMissions = missions.filter(m => m.officialId === editingNote.officialId && m.month === month && m.year === year);

    // Filter out empty HTML tags (e.g., <p><br></p>)
    const cleanText = editingNote.text.replace(/<(.|\n)*?>/g, '').trim() ? editingNote.text : '';

    try {
      setIsSavingNote(true);
      
      // Merge all duplicates first
      const allDays = Array.from(new Set(matchingMissions.flatMap(m => m.days || [])));
      const allNotes = matchingMissions.reduce((acc, m) => ({ ...acc, ...(m.notes || {}) }), {} as Record<string, string>);

      const newNotes = { ...allNotes };
      const newDays = [...allDays];
      
      if (!newDays.includes(editingNote.day)) {
        newDays.push(editingNote.day);
      }

      if (cleanText) {
        newNotes[editingNote.day.toString()] = cleanText;
      } else {
        delete newNotes[editingNote.day.toString()];
      }
      
      await setDoc(doc(db, 'missions', missionId), {
        id: missionId,
        officialId: editingNote.officialId,
        month,
        year,
        days: newDays,
        notes: newNotes
      });

      // Delete other duplicates
      for (const m of matchingMissions) {
        if (m.id !== missionId) {
          await deleteDoc(doc(db, 'missions', m.id));
        }
      }
      
      showToast('រក្សាទុកកំណត់ចំណាំបានជោគជ័យ');
      setEditingNote(null);
    } catch (err) {
      showToast('បរាជ័យក្នុងការរក្សាទុកកំណត់ចំណាំ', 'error');
      handleFirestoreError(err, OperationType.WRITE, 'missions');
    } finally {
      setIsSavingNote(false);
    }
  };

  const toggleOfficialSelection = (id: string) => {
    setSelectedOfficialIds(prev => 
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const toggleDayForSelected = async (day: number) => {
    if (!isEditor || selectedOfficialIds.length === 0) return;

    const month = getMonth(currentDate) + 1;
    const year = getYear(currentDate);
    
    // Check if the day is currently active for ALL selected officials
    const selectedMissions = missions.filter(m => 
      selectedOfficialIds.includes(m.officialId) && 
      m.month === month && 
      m.year === year
    );
    
    const allHaveDay = selectedOfficialIds.every(id => {
      const m = selectedMissions.find(sm => sm.officialId === id);
      return m?.days.includes(day);
    });

    try {
      const promises = selectedOfficialIds.map(async (officialId) => {
        const missionId = `${officialId}_${month}_${year}`;
        const existingMission = selectedMissions.find(m => m.officialId === officialId);
        
        if (existingMission) {
          const newDays = allHaveDay 
            ? existingMission.days.filter(d => d !== day)
            : Array.from(new Set([...existingMission.days, day]));
          
          return updateDoc(doc(db, 'missions', existingMission.id), {
            days: newDays
          });
        } else if (!allHaveDay) {
          return setDoc(doc(db, 'missions', missionId), {
            id: missionId,
            officialId,
            month,
            year,
            days: [day],
            notes: {}
          });
        }
      });

      await Promise.all(promises);
      showToast(allHaveDay ? 'បានលុបបេសកកម្មជាក្រុម' : 'បានបន្ថែមបេសកកម្មជាក្រុម');
    } catch (err) {
      showToast('បរាជ័យក្នុងការធ្វើបច្ចុប្បន្នភាពជាក្រុម', 'error');
      handleFirestoreError(err, OperationType.WRITE, 'missions');
    }
  };

  const toggleAllOfficialsInList = (list: Official[]) => {
    const listIds = list.map(o => o.id);
    const allSelected = listIds.every(id => selectedOfficialIds.includes(id));
    
    if (allSelected) {
      setSelectedOfficialIds(prev => prev.filter(id => !listIds.includes(id)));
    } else {
      setSelectedOfficialIds(prev => Array.from(new Set([...prev, ...listIds])));
    }
  };

  const handleBulkUpdateNotes = async () => {
    if (!isEditor || selectedOfficialIds.length === 0 || selectedDays.length === 0) return;

    const month = getMonth(currentDate) + 1;
    const year = getYear(currentDate);
    const cleanText = bulkNoteText.replace(/<(.|\n)*?>/g, '').trim() ? bulkNoteText : '';

    try {
      for (const officialId of selectedOfficialIds) {
        const existingMission = missions.find(m => m.officialId === officialId && m.month === month && m.year === year);
        const missionId = `${officialId}_${month}_${year}`;
        
        if (existingMission) {
          const newNotes = { ...(existingMission.notes || {}) };
          const newDays = Array.from(new Set([...(existingMission.days || []), ...selectedDays]));
          
          selectedDays.forEach(day => {
            if (cleanText) {
              newNotes[day.toString()] = cleanText;
            }
          });
          
          await updateDoc(doc(db, 'missions', existingMission.id), {
            notes: newNotes,
            days: newDays
          });
        } else {
          await setDoc(doc(db, 'missions', missionId), {
            id: missionId,
            officialId,
            month,
            year,
            days: selectedDays,
            notes: cleanText ? selectedDays.reduce((acc, day) => {
              acc[day.toString()] = cleanText;
              return acc;
            }, {} as Record<string, string>) : {}
          });
        }
      }
      showToast('បានធ្វើបច្ចុប្បន្នភាពបេសកកម្មជាក្រុម');
      setIsBulkEditing(false);
      setBulkNoteText('');
      setSelectedDays([]);
    } catch (err) {
      showToast('បរាជ័យក្នុងការធ្វើបច្ចុប្បន្នភាពជាក្រុម', 'error');
      handleFirestoreError(err, OperationType.WRITE, 'missions');
    }
  };

  const handleUpdateOfficial = async () => {
    if (!isEditor || !editingOfficial) return;
    if (!editingOfficial.name || !editingOfficial.position || !editingOfficial.group) {
      setError('សូមបំពេញព័ត៌មានដែលចាំបាច់ទាំងអស់។');
      return;
    }
    try {
      await updateDoc(doc(db, 'officials', editingOfficial.id), {
        name: editingOfficial.name,
        position: editingOfficial.position,
        group: editingOfficial.group,
        gender: editingOfficial.gender
      });
      setEditingOfficial(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'officials');
    }
  };

  const updateUserRole = async (uid: string, role: 'admin' | 'editor' | 'viewer') => {
    if (!isAdmin) return;
    try {
      await setDoc(doc(db, 'users', uid), { role }, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${uid}`);
      setError('Failed to update user role.');
    }
  };

  const daysInMonth = getDaysInMonth(currentDate);
  const daysArray = Array.from({ length: daysInMonth }, (_, i) => i + 1);

  const uniqueGroups = useMemo(() => {
    const dynamicGroupNames = groups.map(g => g.name);
    let baseGroups = dynamicGroupNames;
    
    // Leadership group name in Khmer
    const leadershipGroup = 'ថ្នាក់ដឹកនាំ';
    
    if (activeTab === 'leadership') baseGroups = [leadershipGroup];
    if (activeTab === 'officials') baseGroups = dynamicGroupNames.filter(g => getGroupNameKh(g) !== leadershipGroup);
    
    // Also include any groups that exist in the data but aren't in groups collection
    const existingGroups = Array.from(new Set(officials.map(o => o.group))).filter(Boolean);
    
    // Map everything to Khmer names and take unique ones
    const combinedKhmer = Array.from(new Set([...baseGroups, ...existingGroups].map(g => getGroupNameKh(g))));
    
    // Filter combined list based on tab
    if (activeTab === 'leadership') return combinedKhmer.filter(g => g === leadershipGroup);
    if (activeTab === 'officials') return combinedKhmer.filter(g => g !== leadershipGroup);
    return combinedKhmer;
  }, [officials, groups, activeTab]);

  const filteredOfficials = useMemo(() => {
    let result = [...officials];
    
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(o => 
        o.name.toLowerCase().includes(query) || 
        o.position.toLowerCase().includes(query) ||
        (o.group && o.group.toLowerCase().includes(query)) ||
        (o.group && getGroupNameKh(o.group).toLowerCase().includes(query))
      );
    }

    if (selectedGroup !== 'all') {
      result = result.filter(o => getGroupNameKh(o.group) === selectedGroup);
    }

    if (filterDateRange.start !== null && filterDateRange.end !== null) {
      result = result.filter(o => {
        const month = getMonth(currentDate) + 1;
        const year = getYear(currentDate);
        const mission = missions.find(m => m.officialId === o.id && m.month === month && m.year === year);
        if (!mission) return false;
        return mission.days.some(day => day >= filterDateRange.start! && day <= filterDateRange.end!);
      });
    }

    // Default sort by order
    result.sort((a, b) => (a.order || 0) - (b.order || 0));

    return result;
  }, [officials, searchQuery, selectedGroup, filterDateRange, missions]);

  const officialsForExportBase = useMemo(() => {
    let result = [...officials];
    
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(o => 
        o.name.toLowerCase().includes(query) || 
        o.position.toLowerCase().includes(query) ||
        (o.group && o.group.toLowerCase().includes(query))
      );
    }

    if (filterDateRange.start !== null && filterDateRange.end !== null) {
      result = result.filter(o => {
        const month = getMonth(currentDate) + 1;
        const year = getYear(currentDate);
        const mission = missions.find(m => m.officialId === o.id && m.month === month && m.year === year);
        if (!mission) return false;
        return mission.days.some(day => day >= filterDateRange.start! && day <= filterDateRange.end!);
      });
    }

    result.sort((a, b) => (a.order || 0) - (b.order || 0));
    
    return result;
  }, [officials, searchQuery, filterDateRange, missions]);

  useEffect(() => {
    setSelectedGroup('all');
  }, [activeTab]);

  const handleExportToExcel = (config = exportConfig) => {
    const month = getMonth(currentDate) + 1;
    const year = getYear(currentDate);
    const daysInMonth = getDaysInMonth(currentDate);
    
    // Use the base list that ignores main UI group filter
    let officialsToExport = [...officialsForExportBase];

    // Filter by selected groups from the export configuration
    officialsToExport = officialsToExport.filter(o => config.selectedGroups.includes(getGroupNameKh(o.group)));

    if (config.onlyWithMissions) {
      officialsToExport = officialsToExport.filter(o => {
        const mission = missions.find(m => m.officialId === o.id && m.month === month && m.year === year);
        return mission && mission.days.length > 0;
      });
    }

    const data = officialsToExport.map(official => {
      const mission = missions.find(m => m.officialId === official.id && m.month === month && m.year === year);
      const row: any = {};
      
      if (config.columns.name) row['ឈ្មោះ'] = official.name;
      if (config.columns.position) row['តួនាទី'] = official.position;
      if (config.columns.group) row['ក្រុម'] = getGroupNameKh(official.group);
      if (config.columns.gender) row['ភេទ'] = official.gender === 'M' ? 'ប' : official.gender === 'F' ? 'ស' : '-';
      
      if (config.columns.days) {
        for (let day = 1; day <= daysInMonth; day++) {
          row[day.toString()] = mission?.days.includes(day) ? 'X' : '';
        }
      }
      
      return row;
    });

    // Explicitly define header order to prevent numeric keys from being sorted first
    const header = [];
    if (config.columns.name) header.push('ឈ្មោះ');
    if (config.columns.position) header.push('តួនាទី');
    if (config.columns.group) header.push('ក្រុម');
    if (config.columns.gender) header.push('ភេទ');
    if (config.columns.days) {
      for (let day = 1; day <= daysInMonth; day++) {
        header.push(day.toString());
      }
    }

    const worksheet = XLSX.utils.json_to_sheet(data, { header });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, `Missions_${month}_${year}`);
    
    const fileName = `Mission_Data_${month}_${year}.xlsx`;
    XLSX.writeFile(workbook, fileName);
    setIsPreviewingExport(false);
  };

  const handlePrint = (config = exportConfig) => {
    const month = getMonth(currentDate) + 1;
    const year = getYear(currentDate);
    const daysInMonth = getDaysInMonth(currentDate);
    const monthName = kmMonths[getMonth(currentDate)];
    
    let officialsToPrint = [...officialsForExportBase];
    officialsToPrint = officialsToPrint.filter(o => config.selectedGroups.includes(getGroupNameKh(o.group)));

    if (config.onlyWithMissions) {
      officialsToPrint = officialsToPrint.filter(o => {
        const mission = missions.find(m => m.officialId === o.id && m.month === month && m.year === year);
        return mission && mission.days.length > 0;
      });
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>បោះពុម្ពបញ្ជីបេសកកម្ម - ${monthName} ${year}</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Battambang:wght@400;700&display=swap');
          body {
            font-family: 'Battambang', sans-serif;
            padding: 20px;
            color: #333;
          }
          .header {
            text-align: center;
            margin-bottom: 20px;
          }
          .header h1 {
            margin: 0;
            font-size: 20px;
            color: #1e40af;
          }
          .header p {
            margin: 5px 0 0;
            font-size: 14px;
            color: #666;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
            font-size: 10px;
          }
          th, td {
            border: 1px solid #000;
            padding: 4px;
            text-align: left;
          }
          th {
            background-color: #f1f5f9;
            font-weight: bold;
          }
          .text-center {
            text-align: center;
          }
          .day-cell {
            width: 15px;
            min-width: 15px;
          }
          .mission-day {
            color: #dc2626;
            font-weight: bold;
          }
          @media print {
            @page {
              size: landscape;
              margin: 1cm;
            }
            body { padding: 0; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>បញ្ជីបេសកកម្មនាយកដ្ឋានរដ្ឋបាល</h1>
          <p>សម្រាប់ខែ ${monthName} ឆ្នាំ ${year}</p>
        </div>
        <table>
          <thead>
            <tr>
              <th class="text-center">ល.រ</th>
              ${config.columns.name ? '<th>ឈ្មោះ</th>' : ''}
              ${config.columns.position ? '<th>តួនាទី</th>' : ''}
              ${config.columns.group ? '<th>ក្រុម</th>' : ''}
              ${config.columns.gender ? '<th class="text-center">ភេទ</th>' : ''}
              ${config.columns.days ? Array.from({ length: daysInMonth }, (_, i) => `<th class="text-center day-cell">${i + 1}</th>`).join('') : ''}
            </tr>
          </thead>
          <tbody>
            ${officialsToPrint.map((official, index) => {
              const mission = missions.find(m => m.officialId === official.id && m.month === month && m.year === year);
              return `
                <tr>
                  <td class="text-center">${index + 1}</td>
                  ${config.columns.name ? `<td>${official.name}</td>` : ''}
                  ${config.columns.position ? `<td>${official.position}</td>` : ''}
                  ${config.columns.group ? `<td>${getGroupNameKh(official.group)}</td>` : ''}
                  ${config.columns.gender ? `<td class="text-center">${official.gender === 'M' ? 'ប' : 'ស'}</td>` : ''}
                  ${config.columns.days ? Array.from({ length: daysInMonth }, (_, i) => {
                    const day = i + 1;
                    const isMission = mission?.days.includes(day);
                    return `<td class="text-center day-cell ${isMission ? 'mission-day' : ''}">${isMission ? 'X' : ''}</td>`;
                  }).join('') : ''}
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
        <script>
          window.onload = () => {
            setTimeout(() => {
              window.print();
            }, 500);
          };
        </script>
      </body>
      </html>
    `;

    printWindow.document.write(html);
    printWindow.document.close();
  };

  const leadershipOfficials = useMemo(() => 
    filteredOfficials.filter(o => o.group === 'Leadership'),
    [filteredOfficials]
  );
  
  const otherOfficials = useMemo(() => 
    filteredOfficials.filter(o => o.group !== 'Leadership'),
    [filteredOfficials]
  );

  const otherGroups = useMemo(() => 
    Array.from(new Set(otherOfficials.map(o => o.group))),
    [otherOfficials]
  );

  if (!isAuthReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-gray-950 dark:to-gray-900 p-4">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-gray-900 p-8 rounded-3xl shadow-2xl max-w-md w-full border border-gray-100 dark:border-gray-800"
        >
          <div className="text-center mb-8">
            <div className="w-20 h-20 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
              <Calendar className="text-white w-10 h-10" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">ប្រព័ន្ធគ្រប់គ្រងបេសកកម្ម</h1>
            <p className="text-gray-600 dark:text-gray-400">នាយកដ្ឋានរដ្ឋបាល</p>
          </div>

          <form onSubmit={handleEmailLogin} className="space-y-5">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">អ៊ីមែល</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input 
                  type="email" 
                  value={loginEmail}
                  onChange={e => setLoginEmail(e.target.value)}
                  required
                  className="w-full pl-12 pr-4 py-3 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all dark:text-white"
                  placeholder="example@email.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-2">ពាក្យសម្ងាត់</label>
              <div className="relative">
                <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input 
                  type={showPassword ? "text" : "password"}
                  value={loginPassword}
                  onChange={e => setLoginPassword(e.target.value)}
                  required
                  className="w-full pl-12 pr-12 py-3 bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 rounded-2xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all dark:text-white"
                  placeholder="••••••••"
                />
                <button 
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {authError && (
              <div className="p-3 bg-red-50 border border-red-100 text-red-600 text-xs font-bold rounded-xl flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                {authError}
              </div>
            )}

            <button
              type="submit"
              disabled={isAuthLoading}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 px-6 rounded-2xl transition-all shadow-lg shadow-blue-100 flex items-center justify-center gap-3 disabled:opacity-50"
            >
              {isAuthLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShieldCheck className="w-5 h-5" />}
              ចូលប្រើប្រាស់
            </button>
          </form>

          <div className="relative my-8">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-gray-100"></div>
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-white dark:bg-gray-900 px-4 text-gray-400 dark:text-gray-500 font-medium">ឬចូលតាមរយៈ</span>
            </div>
          </div>

          <button
            onClick={handleLogin}
            disabled={isAuthLoading}
            className="w-full bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 font-bold py-3.5 px-6 rounded-2xl transition-all flex items-center justify-center gap-3 shadow-sm disabled:opacity-50"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5 bg-white dark:bg-white rounded-full p-0.5" alt="Google" />
            Google Account
          </button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 font-sans transition-colors duration-300">
      {/* Header */}
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-[100]">
        <div className="max-w-[1600px] mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center shadow-sm">
              <Calendar className="text-white w-6 h-6" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight dark:text-white">ប្រព័ន្ធគ្រប់គ្រងបេសកកម្ម</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">នាយកដ្ឋានរដ្ឋបាល</p>
            </div>
          </div>

          <div className="flex items-center gap-4 ml-8 border-l border-gray-200 dark:border-gray-800 pl-8">
            <button
              onClick={() => setMainView('missions')}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg transition-all font-bold text-sm",
                mainView === 'missions' 
                  ? "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400" 
                  : "text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
              )}
            >
              <Calendar className="w-4 h-4" />
              គ្រប់គ្រងបេសកកម្ម
            </button>
            <button
              onClick={() => setMainView('committees')}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg transition-all font-bold text-sm",
                mainView === 'committees' 
                  ? "bg-blue-50 text-blue-600 dark:bg-blue-900/30 dark:text-blue-400" 
                  : "text-gray-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
              )}
            >
              <Users className="w-4 h-4" />
              ក្រុមការងារ/គណៈកម្មការ
            </button>
          </div>

          <div className="flex-1" />

          <div className="flex items-center gap-4">
            <div className="relative">
              <button
                onClick={() => setShowReminders(!showReminders)}
                className={cn(
                  "p-2 rounded-lg transition-all relative",
                  showReminders ? "bg-blue-50 text-blue-600" : "text-gray-500 hover:text-blue-600 hover:bg-blue-50"
                )}
                title="ការរំលឹក"
              >
                <Bell className="w-5 h-5" />
                {reminders.length > 0 && (
                  <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center border-2 border-white">
                    {reminders.length > 99 ? '99+' : reminders.length}
                  </span>
                )}
              </button>

              <AnimatePresence>
                {showReminders && (
                  <>
                    <div 
                      className="fixed inset-0 z-40" 
                      onClick={() => setShowReminders(false)} 
                    />
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      className="absolute right-0 mt-2 w-80 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-800 z-[110] overflow-hidden"
                    >
                      <div className="p-4 border-b border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-800/50 flex items-center justify-between">
                        <h3 className="font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                          <Bell className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                          ការរំលឹក និងការជូនដំណឹង
                        </h3>
                        <span className="text-[10px] font-bold bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full uppercase">
                          {reminders.length} ថ្មី
                        </span>
                      </div>
                      <div className="max-h-[400px] overflow-y-auto p-2 space-y-1">
                        {reminders.length === 0 ? (
                          <div className="p-8 text-center">
                            <div className="w-12 h-12 bg-gray-50 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-3">
                              <CheckCircle2 className="w-6 h-6 text-gray-300 dark:text-gray-600" />
                            </div>
                            <p className="text-sm text-gray-500 dark:text-gray-400">មិនមានការរំលឹកទេ</p>
                          </div>
                        ) : (
                          reminders.map(reminder => (
                            <div 
                              key={reminder.id}
                              className={cn(
                                "p-3 rounded-xl border transition-all",
                                reminder.severity === 'error' ? "bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-800/50" :
                                reminder.severity === 'warning' ? "bg-amber-50 dark:bg-amber-900/20 border-amber-100 dark:border-amber-800/50" :
                                "bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-800/50"
                              )}
                            >
                              <div className="flex gap-3">
                                <div className={cn(
                                  "w-8 h-8 rounded-lg flex items-center justify-center shrink-0",
                                  reminder.severity === 'error' ? "bg-red-100 dark:bg-red-900/40 text-red-600 dark:text-red-400" :
                                  reminder.severity === 'warning' ? "bg-amber-100 dark:bg-amber-900/40 text-amber-600 dark:text-amber-400" :
                                  "bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400"
                                )}>
                                  {reminder.type === 'upcoming' ? <Calendar className="w-4 h-4" /> : <Info className="w-4 h-4" />}
                                </div>
                                <div className="min-w-0">
                                  <p className="text-xs font-bold text-gray-900 dark:text-gray-100 truncate">{reminder.officialName}</p>
                                  <p className={cn(
                                    "text-[11px] leading-relaxed",
                                    reminder.severity === 'error' ? "text-red-700 dark:text-red-300" :
                                    reminder.severity === 'warning' ? "text-amber-700 dark:text-amber-300" :
                                    "text-blue-700 dark:text-blue-300"
                                  )}>
                                    {reminder.message}
                                  </p>
                                </div>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>

            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-gray-100 dark:bg-gray-800 rounded-full">
              <img src={user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || 'User')}&background=random`} className="w-6 h-6 rounded-full" alt="" />
              <span className="text-sm font-medium dark:text-gray-200">{user.displayName}</span>
              {isAdmin && <span className="text-[10px] bg-brand text-white px-1.5 py-0.5 rounded uppercase font-bold">អ្នកគ្រប់គ្រង</span>}
              {!isAdmin && isEditor && <span className="text-[10px] bg-purple-600 text-white px-1.5 py-0.5 rounded uppercase font-bold">អ្នកកែសម្រួល</span>}
            </div>
            <div className="relative group">
              {isAdmin && (
                <button
                  className="p-2 text-gray-500 hover:text-brand hover:bg-brand-light rounded-lg transition-colors flex items-center gap-1"
                  title="ការកំណត់"
                >
                  <Settings className="w-5 h-5" />
                  <ChevronDown className="w-3 h-3" />
                </button>
              )}
              
              {isAdmin && (
                <div className="absolute right-0 mt-1 w-56 bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-100 dark:border-gray-800 py-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-[110]">
                  <div className="px-4 py-2 border-b border-gray-50 dark:border-gray-800 mb-1">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">ការកំណត់ប្រព័ន្ធ</p>
                  </div>
                  <button
                    onClick={() => setIsManagingUsers(true)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-brand-light dark:hover:bg-gray-800 hover:text-brand transition-colors"
                  >
                    <Users className="w-4 h-4" />
                    គ្រប់គ្រងអ្នកប្រើប្រាស់
                  </button>
                  <button
                    onClick={() => setIsManagingGroups(true)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-brand-light dark:hover:bg-gray-800 hover:text-brand transition-colors"
                  >
                    <Layout className="w-4 h-4" />
                    គ្រប់គ្រងប្រភេទក្រុម
                  </button>
                  <button
                    onClick={() => setIsImporting(true)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 dark:text-gray-300 hover:bg-brand-light dark:hover:bg-gray-800 hover:text-brand transition-colors"
                  >
                    <FileUp className="w-4 h-4" />
                    នាំចូលទិន្នន័យមន្ត្រី
                  </button>

                  <div className="px-4 py-2 border-t border-b border-gray-50 dark:border-gray-800 my-1">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">រចនាប័ទ្ម (Themes)</p>
                  </div>
                  <div className="px-4 py-2 flex items-center justify-between">
                    <span className="text-sm text-gray-600 dark:text-gray-400">រចនាប័ទ្មងងឹត</span>
                    <button 
                      onClick={() => setIsDarkMode(!isDarkMode)}
                      className={cn(
                        "w-10 h-5 rounded-full transition-all relative",
                        isDarkMode ? "bg-brand" : "bg-gray-200"
                      )}
                    >
                      <div className={cn(
                        "absolute top-1 w-3 h-3 rounded-full bg-white transition-all",
                        isDarkMode ? "left-6" : "left-1"
                      )} />
                    </button>
                  </div>
                  <div className="px-2 py-1 grid grid-cols-5 gap-1">
                    {[
                      { id: 'blue', color: 'bg-blue-600' },
                      { id: 'slate', color: 'bg-slate-900' },
                      { id: 'emerald', color: 'bg-emerald-600' },
                      { id: 'indigo', color: 'bg-indigo-600' },
                      { id: 'rose', color: 'bg-rose-600' }
                    ].map(t => (
                      <button
                        key={t.id}
                        onClick={() => setTheme(t.id as any)}
                        className={cn(
                          "w-8 h-8 rounded-full border-2 transition-all flex items-center justify-center",
                          t.color,
                          theme === t.id ? "border-white ring-2 ring-blue-500 scale-110" : "border-transparent hover:scale-105"
                        )}
                        title={t.id}
                      >
                        {theme === t.id && <CheckCircle2 className="w-4 h-4 text-white" />}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={handleLogout}
              className="p-2 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
              title="ចាកចេញ"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1600px] mx-auto p-4 md:p-6">
        {mainView === 'missions' ? (
          <>
            {/* Controls */}
            <div className="flex flex-col lg:flex-row gap-6 items-center justify-start mb-8">
          <div className="flex items-center gap-3 bg-white dark:bg-gray-900 p-1.5 rounded-xl shadow-sm border border-gray-200 dark:border-gray-800 shrink-0">
            <button 
              onClick={() => setCurrentDate(subMonths(currentDate, 1))}
              className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors dark:text-gray-400"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="flex flex-col items-center min-w-[120px]">
              <span className="text-[10px] text-gray-500 dark:text-gray-400 font-bold uppercase tracking-wider">
                ឆ្នាំ {format(currentDate, 'yyyy', { locale: km })}
              </span>
              <span className="text-lg font-bold text-blue-600 dark:text-blue-400">
                ខែ {format(currentDate, 'MMMM', { locale: km })}
              </span>
            </div>
            <button 
              onClick={() => setCurrentDate(addMonths(currentDate, 1))}
              className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors dark:text-gray-400"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
            <button 
              onClick={() => setCurrentDate(new Date())}
              className="px-2 py-1 text-[10px] font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors border border-blue-100 dark:border-blue-900/50 ml-1"
            >
              ថ្ងៃនេះ
            </button>
          </div>

          <div className="flex-1 w-full flex flex-col sm:flex-row items-center gap-3 transition-all duration-300">
            <div className="relative flex-1 group w-full">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 group-focus-within:text-blue-500 transition-all" />
              <input 
                type="text" 
                placeholder="ស្វែងរកតាមឈ្មោះ ឬតួនាទី..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-12 pr-4 py-3.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl focus:ring-4 focus:ring-blue-100 dark:focus:ring-blue-900/20 focus:border-blue-500 outline-none transition-all shadow-sm hover:border-gray-300 dark:hover:border-gray-700 focus:shadow-md text-base dark:text-white"
              />
            </div>
            {filterDateRange.start !== null && (
              <div className="flex items-center gap-2 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-3 py-1.5 rounded-xl border border-blue-100 dark:border-blue-800 animate-in fade-in zoom-in duration-200 shadow-sm shrink-0">
                <Calendar className="w-3.5 h-3.5" />
                <span className="text-xs font-bold">
                  {filterDateRange.end !== null 
                    ? `ថ្ងៃទី ${filterDateRange.start} - ${filterDateRange.end}`
                    : `ថ្ងៃទី ${filterDateRange.start}`}
                </span>
                <button 
                  onClick={() => setFilterDateRange({ start: null, end: null })} 
                  className="hover:bg-blue-100 dark:hover:bg-blue-800 p-0.5 rounded-full transition-colors"
                  title="Clear filter"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
            <div className="relative w-full sm:w-auto sm:min-w-[200px]">
              <select
                value={selectedGroup}
                onChange={(e) => setSelectedGroup(e.target.value)}
                className="w-full appearance-none pl-4 pr-10 py-3.5 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-2xl focus:ring-4 focus:ring-brand-light dark:focus:ring-brand/20 focus:border-brand outline-none transition-all shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 cursor-pointer hover:border-gray-300 dark:hover:border-gray-700"
              >
                <option value="all">គ្រប់ក្រុមទាំងអស់</option>
                {uniqueGroups.map(group => (
                  <option key={group} value={group}>
                    {group}
                  </option>
                ))}
              </select>
              <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-gray-400">
                <ChevronDown className="w-4 h-4" />
              </div>
            </div>
            <div className="flex items-center bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-1 shadow-sm">
              <button
                onClick={() => setViewMode('table')}
                className={cn(
                  "p-2 rounded-lg transition-all",
                  viewMode === 'table' ? "bg-brand-light dark:bg-gray-800 text-brand" : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                )}
                title="តារាង"
              >
                <TableIcon className="w-5 h-5" />
              </button>
              <button
                onClick={() => setViewMode('calendar')}
                className={cn(
                  "p-2 rounded-lg transition-all",
                  viewMode === 'calendar' ? "bg-brand-light dark:bg-gray-800 text-brand" : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                )}
                title="ប្រតិទិន"
              >
                <Layout className="w-5 h-5" />
              </button>
              <button
                onClick={() => setViewMode('dashboard')}
                className={cn(
                  "p-2 rounded-lg transition-all",
                  viewMode === 'dashboard' ? "bg-brand-light dark:bg-gray-800 text-brand" : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                )}
                title="Dashboard"
              >
                <TrendingUp className="w-5 h-5" />
              </button>
            </div>
            <button
              onClick={() => {
                setExportConfig(prev => ({ ...prev, selectedGroups: uniqueGroups }));
                setIsPreviewingExport(true);
              }}
              className="flex items-center gap-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 px-4 py-2.5 rounded-xl font-medium transition-all shadow-sm"
            >
              <FileSpreadsheet className="w-5 h-5" />
              ទាញយក Excel
            </button>
          </div>

          <div className="flex items-center gap-3">
            {isEditor && (
              <>
                {selectedOfficialIds.length > 0 && (
                  <button
                    onClick={() => {
                      setSelectedDays([]);
                      setBulkNoteText('');
                      setIsBulkEditing(true);
                    }}
                    className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white px-4 py-2.5 rounded-xl font-medium transition-all shadow-sm hover:shadow-md animate-in fade-in zoom-in duration-200"
                  >
                    <FileText className="w-5 h-5" />
                    កែសម្រួលកំណត់ចំណាំ ({selectedOfficialIds.length})
                  </button>
                )}
                <button
                  onClick={() => setIsImporting(true)}
                  className="flex items-center gap-2 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-300 px-4 py-2.5 rounded-xl font-medium transition-all shadow-sm"
                >
                  <FileUp className="w-5 h-5" />
                  នាំចូលទិន្នន័យ
                </button>
                <button
                  onClick={() => setIsAddingOfficial(true)}
                  className="flex items-center gap-2 bg-brand hover:bg-brand-hover text-white px-4 py-2.5 rounded-xl font-medium transition-all shadow-sm hover:shadow-md"
                >
                  <UserPlus className="w-5 h-5" />
                  បន្ថែមមន្ត្រី
                </button>
              </>
            )}
          </div>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-center gap-3">
            <AlertCircle className="w-5 h-5 shrink-0" />
            <p className="text-sm">{error}</p>
            <button onClick={() => setError(null)} className="ml-auto">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Table Container */}
        <AnimatePresence mode="wait">
          {viewMode === 'dashboard' ? (
            <Dashboard 
              officials={officials}
              missions={missions}
              currentDate={currentDate}
              theme={theme}
              isDarkMode={isDarkMode}
            />
          ) : viewMode === 'table' ? (
            <motion.div 
              key="table"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-6"
            >
              {/* Tabs */}
              <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-800 mb-2">
                <button
                  onClick={() => setActiveTab('all')}
                  className={cn(
                    "px-6 py-3 text-sm font-bold transition-all relative",
                    activeTab === 'all' ? "text-brand" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  )}
                >
                  ទាំងអស់
                  {activeTab === 'all' && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand" />}
                </button>
                <button
                  onClick={() => setActiveTab('leadership')}
                  className={cn(
                    "px-6 py-3 text-sm font-bold transition-all relative",
                    activeTab === 'leadership' ? "text-brand" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  )}
                >
                  ថ្នាក់ដឹកនាំ
                  {activeTab === 'leadership' && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand" />}
                </button>
                <button
                  onClick={() => setActiveTab('officials')}
                  className={cn(
                    "px-6 py-3 text-sm font-bold transition-all relative",
                    activeTab === 'officials' ? "text-brand" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  )}
                >
                  នាយកដ្ឋានរដ្ឋបាល
                  {activeTab === 'officials' && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand" />}
                </button>
              </div>

              {/* Leadership Table */}
              {(activeTab === 'all' || activeTab === 'leadership') && leadershipOfficials.length > 0 && (
                <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 overflow-hidden">
                  <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead className="sticky top-0 z-30">
                        <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-800">
                          <th className="p-4 text-left font-semibold text-gray-600 dark:text-gray-400 w-12 sticky left-0 top-0 bg-gray-50 dark:bg-gray-800 z-40">
                            <div className="flex items-center gap-2">
                              {isEditor && (
                                <input 
                                  type="checkbox" 
                                  className="w-4 h-4 rounded border-gray-300 dark:border-gray-700 text-blue-600 focus:ring-blue-500 cursor-pointer dark:bg-gray-900"
                                  checked={leadershipOfficials.length > 0 && leadershipOfficials.every(o => selectedOfficialIds.includes(o.id))}
                                  onChange={() => toggleAllOfficialsInList(leadershipOfficials)}
                                />
                              )}
                              <span>ល.រ</span>
                            </div>
                          </th>
                        <th className="p-4 text-left font-semibold text-gray-600 dark:text-gray-400 min-w-[200px] sticky left-12 top-0 bg-gray-50 dark:bg-gray-800 z-40">
                          <div className="flex flex-col gap-1">
                            <span className="text-[10px] uppercase tracking-wider">ឈ្មោះ</span>
                            <span className="text-[10px] uppercase tracking-wider">តួនាទី</span>
                          </div>
                        </th>
                          <th className="p-4 text-center font-semibold text-gray-600 dark:text-gray-400 w-16 sticky top-0 bg-gray-50 dark:bg-gray-800 z-30">ភេទ</th>
                          {daysArray.map(day => {
                            const isWeekend = [0, 6].includes(new Date(getYear(currentDate), getMonth(currentDate), day).getDay());
                            return (
                              <th 
                                key={day} 
                                onClick={() => {
                                  if (isEditor && selectedOfficialIds.length > 0) {
                                    toggleDayForSelected(day);
                                  } else {
                                    // Toggle range selection
                                    if (filterDateRange.start === null || (filterDateRange.start !== null && filterDateRange.end !== null)) {
                                      setFilterDateRange({ start: day, end: null });
                                    } else {
                                      const start = Math.min(filterDateRange.start, day);
                                      const end = Math.max(filterDateRange.start, day);
                                      setFilterDateRange({ start, end });
                                    }
                                  }
                                }}
                                className={cn(
                                  "p-2 text-center font-semibold text-gray-600 dark:text-gray-400 w-10 border-l border-gray-100 dark:border-gray-800 sticky top-0 bg-gray-50 dark:bg-gray-800 z-30 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors",
                                  isWeekend && "bg-orange-50/50 dark:bg-orange-900/10",
                                  filterDateRange.start !== null && filterDateRange.end !== null && day >= filterDateRange.start && day <= filterDateRange.end && "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300",
                                  filterDateRange.start === day && filterDateRange.end === null && "bg-blue-100 dark:bg-blue-900/50 text-blue-700 dark:text-blue-300"
                                )}
                                title={isEditor && selectedOfficialIds.length > 0 
                                  ? `ចុចដើម្បីបន្ថែម/លុបបេសកកម្មថ្ងៃទី ${day} សម្រាប់មន្ត្រីដែលបានជ្រើសរើស` 
                                  : `ចុចដើម្បីជ្រើសរើសចន្លោះថ្ងៃ (Range)`}
                              >
                                {day}
                              </th>
                            );
                          })}
                          {isEditor && <th className="p-4 text-center font-semibold text-gray-600 w-16 sticky top-0 bg-gray-50 z-30">លុប</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {leadershipOfficials.map((official, idx) => {
                          const month = getMonth(currentDate) + 1;
                          const year = getYear(currentDate);
                          const mission = missions.find(m => m.officialId === official.id && m.month === month && m.year === year);
                              return (
                                <tr key={official.id} className={cn(
                                  "border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors group",
                                  selectedOfficialIds.includes(official.id) && "bg-blue-50/30 dark:bg-blue-900/10"
                                )}>
                                  <td className="p-4 text-gray-500 dark:text-gray-400 sticky left-0 bg-white dark:bg-gray-900 group-hover:bg-gray-50 dark:group-hover:bg-gray-800 z-20 transition-colors">
                                    <div className="flex items-center gap-2">
                                      {isEditor && (
                                        <input 
                                          type="checkbox" 
                                          className="w-4 h-4 rounded border-gray-300 dark:border-gray-700 text-blue-600 focus:ring-blue-500 cursor-pointer dark:bg-gray-900"
                                          checked={selectedOfficialIds.includes(official.id)}
                                          onChange={() => toggleOfficialSelection(official.id)}
                                        />
                                      )}
                                      <span>{idx + 1}</span>
                                    </div>
                                  </td>
                                  <td 
                                    className="p-4 sticky left-12 bg-white dark:bg-gray-900 group-hover:bg-gray-50 dark:group-hover:bg-gray-800 z-20 cursor-pointer transition-colors"
                                    onDoubleClick={() => isEditor && setEditingOfficial(official)}
                                    title={isEditor ? "ចុចពីរដងដើម្បីកែសម្រួល" : ""}
                                  >
                                    <div className="font-bold text-gray-900 dark:text-gray-100">{official.name}</div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">{official.position}</div>
                                  </td>
                              <td className="p-4 text-center text-gray-600 dark:text-gray-400">
                                {official.gender === 'M' ? 'ប' : official.gender === 'F' ? 'ស' : '-'}
                              </td>
                              {daysArray.map(day => {
                                const isWeekend = [0, 6].includes(new Date(getYear(currentDate), getMonth(currentDate), day).getDay());
                                const isOnMission = mission?.days.includes(day);
                                const note = mission?.notes?.[day.toString()];
                                return (
                                  <td 
                                    key={day} 
                                    className={cn(
                                      "p-0 border-l border-gray-100 dark:border-gray-800 transition-all cursor-pointer relative group/cell",
                                      isWeekend && "bg-orange-50/20 dark:bg-orange-900/5",
                                      isOnMission && !note && "bg-red-50/40 dark:bg-red-900/20 border-red-200/50 dark:border-red-800/50",
                                      isOnMission && note && "bg-blue-50/40 dark:bg-blue-900/20 border-blue-200/50 dark:border-blue-800/50",
                                      !isEditor && "cursor-default"
                                    )}
                                    onClick={() => toggleMissionDay(official.id, day)}
                                  >
                                    <div className="w-full h-10 flex items-center justify-center relative">
                                      <span className="absolute top-0.5 right-0.5 text-[7px] text-gray-300 dark:text-gray-700 pointer-events-none select-none opacity-50">
                                        {day}
                                      </span>
                                      {isOnMission && (
                                        <motion.div 
                                          initial={{ scale: 0 }}
                                          animate={{ scale: 1 }}
                                          className={cn(
                                            "w-6 h-6 rounded flex items-center justify-center shadow-sm",
                                            note 
                                              ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800" 
                                              : "bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800"
                                          )}
                                        >
                                          {note ? (
                                            <MessageSquare className="w-3.5 h-3.5 fill-blue-600 dark:fill-blue-400" />
                                          ) : (
                                            <Calendar className="w-3.5 h-3.5" />
                                          )}
                                        </motion.div>
                                      )}
                                      {isEditor && (
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setEditingNote({ officialId: official.id, day, text: note || '' });
                                          }}
                                          className="absolute right-0 top-0 p-1 opacity-0 group-hover/cell:opacity-100 hover:bg-blue-50 dark:hover:bg-blue-900/30 text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 transition-all z-10"
                                          title="បន្ថែម/កែសម្រួលកំណត់ចំណាំ"
                                        >
                                          <FileText className="w-3.5 h-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                );
                              })}
                              {isEditor && (
                                <td className="p-4 text-center">
                                  <button 
                                    onClick={() => setDeletingOfficialId(official.id)}
                                    className="p-2 text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-all"
                                    title="លុបមន្ត្រី"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Other Officials Table */}
              {(activeTab === 'all' || activeTab === 'officials') && (
                <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 overflow-hidden">
                <div className="p-4 border-b border-gray-100 dark:border-gray-800 bg-brand-light/30 dark:bg-brand/10">
                  <h3 className="font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
                    <div className="w-2 h-6 bg-brand rounded-full" />
                    នាយកដ្ឋានរដ្ឋបាល
                  </h3>
                </div>
                <div className="overflow-x-auto max-h-[800px] overflow-y-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead className="sticky top-0 z-30">
                      <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-800">
                        <th className="p-4 text-left font-semibold text-gray-600 dark:text-gray-400 w-12 sticky left-0 top-0 bg-gray-50 dark:bg-gray-800 z-40">
                          <div className="flex items-center gap-2">
                            {isEditor && (
                              <input 
                                type="checkbox" 
                                className="w-4 h-4 rounded border-gray-300 dark:border-gray-700 text-brand focus:ring-brand cursor-pointer dark:bg-gray-900"
                                checked={otherOfficials.length > 0 && otherOfficials.every(o => selectedOfficialIds.includes(o.id))}
                                onChange={() => toggleAllOfficialsInList(otherOfficials)}
                              />
                            )}
                            <span>ល.រ</span>
                          </div>
                        </th>
                        <th className="p-4 text-left font-semibold text-gray-600 dark:text-gray-400 min-w-[200px] sticky left-12 top-0 bg-gray-50 dark:bg-gray-800 z-40">
                          <div className="flex flex-col gap-1">
                            <span className="text-[10px] uppercase tracking-wider">ឈ្មោះ</span>
                            <span className="text-[10px] uppercase tracking-wider">តួនាទី</span>
                            <span className="text-[10px] uppercase tracking-wider">ក្រុម</span>
                          </div>
                        </th>
                        <th className="p-4 text-center font-semibold text-gray-600 dark:text-gray-400 w-16 sticky top-0 bg-gray-50 dark:bg-gray-800 z-30">ភេទ</th>
                        {daysArray.map(day => {
                          const isWeekend = [0, 6].includes(new Date(getYear(currentDate), getMonth(currentDate), day).getDay());
                          return (
                            <th 
                              key={day} 
                              onClick={() => {
                                if (isEditor && selectedOfficialIds.length > 0) {
                                  toggleDayForSelected(day);
                                } else {
                                  // Toggle range selection
                                  if (filterDateRange.start === null || (filterDateRange.start !== null && filterDateRange.end !== null)) {
                                    setFilterDateRange({ start: day, end: null });
                                  } else {
                                    const start = Math.min(filterDateRange.start, day);
                                    const end = Math.max(filterDateRange.start, day);
                                    setFilterDateRange({ start, end });
                                  }
                                }
                              }}
                              className={cn(
                                "p-2 text-center font-semibold text-gray-600 dark:text-gray-400 w-10 border-l border-gray-100 dark:border-gray-800 sticky top-0 bg-gray-50 dark:bg-gray-800 z-30 cursor-pointer hover:bg-brand-light dark:hover:bg-brand/20 transition-colors",
                                isWeekend && "bg-orange-50/50 dark:bg-orange-900/10",
                                filterDateRange.start !== null && filterDateRange.end !== null && day >= filterDateRange.start && day <= filterDateRange.end && "bg-brand-shadow dark:bg-brand/40 text-brand-hover dark:text-brand-light",
                                filterDateRange.start === day && filterDateRange.end === null && "bg-brand-shadow dark:bg-brand/40 text-brand-hover dark:text-brand-light"
                              )}
                              title={isEditor && selectedOfficialIds.length > 0 
                                ? `ចុចដើម្បីបន្ថែម/លុបបេសកកម្មថ្ងៃទី ${day} សម្រាប់មន្ត្រីដែលបានជ្រើសរើស` 
                                : `ចុចដើម្បីជ្រើសរើសចន្លោះថ្ងៃ (Range)`}
                            >
                              {day}
                            </th>
                          );
                        })}
                        {isEditor && <th className="p-4 text-center font-semibold text-gray-600 dark:text-gray-400 w-16 sticky top-0 bg-gray-50 dark:bg-gray-800 z-30">លុប</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {otherGroups.length === 0 && leadershipOfficials.length === 0 && (
                        <tr>
                          <td colSpan={daysInMonth + 4} className="p-12 text-center text-gray-500 dark:text-gray-400 italic">
                            មិនមានមន្ត្រីត្រូវបានរកឃើញទេ។ សូមបន្ថែមមន្ត្រីដើម្បីចាប់ផ្តើម។
                          </td>
                        </tr>
                      )}
                      {otherGroups.map(groupName => (
                        <React.Fragment key={groupName}>
                          <tr className="bg-gray-100/80 dark:bg-gray-800/50 border-y border-gray-200 dark:border-gray-800">
                            <td colSpan={daysInMonth + 4} className="p-3 font-bold text-brand-hover dark:text-brand-light uppercase tracking-wide text-xs">
                              {getGroupNameKh(groupName)}
                            </td>
                          </tr>
                          {otherOfficials
                            .filter(o => o.group === groupName)
                            .map((official, idx) => {
                              const month = getMonth(currentDate) + 1;
                              const year = getYear(currentDate);
                              const mission = missions.find(m => m.officialId === official.id && m.month === month && m.year === year);
                              return (
                                <tr key={official.id} className={cn(
                                  "border-b border-gray-100 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/50 transition-colors group",
                                  selectedOfficialIds.includes(official.id) && "bg-blue-50/30 dark:bg-blue-900/10"
                                )}>
                                  <td className="p-4 text-gray-500 dark:text-gray-400 sticky left-0 bg-white dark:bg-gray-900 group-hover:bg-gray-50 dark:group-hover:bg-gray-800 z-20 transition-colors">
                                    <div className="flex items-center gap-2">
                                      {isEditor && (
                                        <input 
                                          type="checkbox" 
                                          className="w-4 h-4 rounded border-gray-300 dark:border-gray-700 text-blue-600 focus:ring-blue-500 cursor-pointer dark:bg-gray-900"
                                          checked={selectedOfficialIds.includes(official.id)}
                                          onChange={() => toggleOfficialSelection(official.id)}
                                        />
                                      )}
                                      <span>{idx + 1}</span>
                                    </div>
                                  </td>
                                  <td 
                                    className="p-4 sticky left-12 bg-white dark:bg-gray-900 group-hover:bg-gray-50 dark:group-hover:bg-gray-800 z-20 cursor-pointer transition-colors"
                                    onDoubleClick={() => isEditor && setEditingOfficial(official)}
                                    title={isEditor ? "ចុចពីរដងដើម្បីកែសម្រួល" : ""}
                                  >
                                    <div className="font-bold text-gray-900 dark:text-gray-100">{official.name}</div>
                                    <div className="text-xs text-gray-500 dark:text-gray-400">{official.position}</div>
                                  </td>
                              <td className="p-4 text-center text-gray-600 dark:text-gray-400">
                                {official.gender === 'M' ? 'ប' : official.gender === 'F' ? 'ស' : '-'}
                              </td>
                                  {daysArray.map(day => {
                                    const isWeekend = [0, 6].includes(new Date(getYear(currentDate), getMonth(currentDate), day).getDay());
                                    const isOnMission = mission?.days.includes(day);
                                    const note = mission?.notes?.[day.toString()];
                                    return (
                                      <td 
                                        key={day} 
                                        className={cn(
                                          "p-0 border-l border-gray-100 dark:border-gray-800 transition-all cursor-pointer relative group/cell",
                                          isWeekend && "bg-orange-50/20 dark:bg-orange-900/5",
                                          isOnMission && !note && "bg-red-50/40 dark:bg-red-900/20 border-red-200/50 dark:border-red-800/50",
                                          isOnMission && note && "bg-blue-50/40 dark:bg-blue-900/20 border-blue-200/50 dark:border-blue-800/50",
                                          !isEditor && "cursor-default"
                                        )}
                                        onClick={() => toggleMissionDay(official.id, day)}
                                      >
                                        <div className="w-full h-10 flex items-center justify-center relative">
                                          <span className="absolute top-0.5 right-0.5 text-[7px] text-gray-300 dark:text-gray-700 pointer-events-none select-none opacity-50">
                                            {day}
                                          </span>
                                          {isOnMission && (
                                            <motion.div 
                                              initial={{ scale: 0 }}
                                              animate={{ scale: 1 }}
                                              className={cn(
                                                "w-6 h-6 rounded flex items-center justify-center shadow-sm",
                                                note 
                                                  ? "bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800" 
                                                  : "bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800"
                                              )}
                                            >
                                              {note ? (
                                                <MessageSquare className="w-3.5 h-3.5 fill-blue-600 dark:fill-blue-400" />
                                              ) : (
                                                <Calendar className="w-3.5 h-3.5" />
                                              )}
                                            </motion.div>
                                          )}
                                          {isEditor && (
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                setEditingNote({ officialId: official.id, day, text: note || '' });
                                              }}
                                              className="absolute right-0 top-0 p-1 opacity-0 group-hover/cell:opacity-100 hover:bg-blue-50 dark:hover:bg-blue-900/30 text-gray-400 dark:text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 transition-all z-10"
                                              title="បន្ថែម/កែសម្រួលកំណត់ចំណាំ"
                                            >
                                              <FileText className="w-3.5 h-3.5" />
                                            </button>
                                          )}
                                        </div>
                                      </td>
                                    );
                                  })}
                                  {isEditor && (
                                    <td className="p-4 text-center">
                                      <button 
                                        onClick={() => setDeletingOfficialId(official.id)}
                                        className="p-2 text-gray-400 dark:text-gray-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-all"
                                        title="លុបមន្ត្រី"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                    </td>
                                  )}
                                </tr>
                              );
                            })}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </motion.div>
          ) : (
            <motion.div 
              key="calendar"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 overflow-hidden p-6"
            >
              <div className="grid grid-cols-7 gap-px bg-gray-200 dark:bg-gray-800 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
                {['អាទិត្យ', 'ច័ន្ទ', 'អង្គារ', 'ពុធ', 'ព្រហស្បតិ៍', 'សុក្រ', 'សៅរ៍'].map(day => (
                  <div key={day} className="bg-gray-50 dark:bg-gray-800 p-3 text-center font-bold text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider">
                    {day}
                  </div>
                ))}
                {(() => {
                  const monthStart = startOfMonth(currentDate);
                  const monthEnd = endOfMonth(monthStart);
                  const startDate = startOfWeek(monthStart);
                  const endDate = endOfWeek(monthEnd);
                  const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });

                  return calendarDays.map(day => {
                    const dayMissions = missions.filter(m => m.days.includes(day.getDate()) && isSameMonth(day, currentDate));
                    const isCurrentMonth = isSameMonth(day, currentDate);
                    const isWeekend = [0, 6].includes(day.getDay());
                    const hasAnyNote = dayMissions.some(m => m.notes?.[day.getDate().toString()]);

                    return (
                      <div 
                        key={day.toString()} 
                        onClick={() => {
                          if (isCurrentMonth) {
                            setFilterDateRange({ start: day.getDate(), end: day.getDate() });
                            setViewMode('table');
                          }
                        }}
                        className={cn(
                          "bg-white dark:bg-gray-900 min-h-[140px] p-2 flex flex-col gap-1 transition-all border-2 cursor-pointer hover:border-blue-300 dark:hover:border-blue-500",
                          !isCurrentMonth && "bg-gray-50/50 dark:bg-gray-800/50 opacity-40 border-transparent cursor-default hover:border-transparent",
                          isWeekend && isCurrentMonth && "bg-blue-50/10 dark:bg-blue-900/5 border-transparent",
                          dayMissions.length > 0 && isCurrentMonth && (
                            hasAnyNote 
                              ? "bg-blue-50/40 dark:bg-blue-900/20 border-blue-200/50 dark:border-blue-800/50 shadow-inner" 
                              : "bg-red-50/40 dark:bg-red-900/20 border-red-200/50 dark:border-red-800/50 shadow-inner"
                          ),
                          dayMissions.length === 0 && isCurrentMonth && "border-transparent"
                        )}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className={cn(
                            "text-sm font-bold w-7 h-7 flex items-center justify-center rounded-full",
                            isToday(day) ? "bg-blue-600 text-white" : "text-gray-700 dark:text-gray-300"
                          )}>
                            {format(day, 'd')}
                          </span>
                          {isCurrentMonth && dayMissions.length > 0 && (
                            hasAnyNote ? (
                              <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 p-1 rounded-md shadow-sm">
                                <MessageSquare className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 fill-blue-600 dark:fill-blue-400" />
                              </div>
                            ) : (
                              <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 p-1 rounded-md shadow-sm">
                                <Calendar className="w-3.5 h-3.5 text-red-600 dark:text-red-400" />
                              </div>
                            )
                          )}
                        </div>
                        <div className="flex flex-col gap-1 overflow-y-auto max-h-[100px] scrollbar-hide">
                          {dayMissions.map(m => {
                            const official = officials.find(o => o.id === m.officialId);
                            if (!official) return null;
                            const note = m.notes?.[day.getDate().toString()];
                            return (
                              <div 
                                key={m.id} 
                                className={cn(
                                  "text-[10px] px-1.5 py-1 rounded border flex items-center justify-between group/cal-item transition-all",
                                  note 
                                    ? "bg-blue-50 text-blue-700 border-blue-200 shadow-sm" 
                                    : "bg-red-50 text-red-700 border-red-100"
                                )}
                                title={note ? note.replace(/<(.|\n)*?>/g, '') : official.name}
                              >
                                <span className="truncate font-medium">{official.name}</span>
                                {note && <MessageSquare className="w-2.5 h-2.5 text-blue-500 fill-blue-500 shrink-0" />}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Legend */}
        <div className="mt-8 flex flex-wrap items-center gap-6 text-sm text-gray-500 bg-white p-4 rounded-xl border border-gray-200 shadow-sm w-fit">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-red-50 border border-red-200 rounded flex items-center justify-center shadow-sm">
              <Calendar className="w-3.5 h-3.5 text-red-600" />
            </div>
            <span>បេសកកម្ម (គ្មានកំណត់ចំណាំ)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-blue-50 border border-blue-200 rounded flex items-center justify-center shadow-sm">
              <MessageSquare className="w-3.5 h-3.5 text-blue-600 fill-blue-600" />
            </div>
            <span>បេសកកម្ម (មានកំណត់ចំណាំ)</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-blue-50/10 border border-blue-100 rounded" />
            <span>ថ្ងៃឈប់សម្រាក</span>
          </div>
        </div>
        </>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 rounded-2xl flex items-center justify-center shadow-sm">
                  <Users className="text-emerald-600 dark:text-emerald-400 w-7 h-7" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-gray-900 dark:text-white tracking-tight">ក្រុមការងារ/គណៈកម្មការ</h2>
                  <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">បញ្ជីរាយនាមមន្ត្រីតាមក្រុមការងារ និងគណៈកម្មការនានា</p>
                </div>
              </div>
              {isEditor && (
                <button
                  onClick={() => {
                    setCommitteeRows([{ id: Math.random().toString(36).substr(2, 9), objective: '', ministry: '', documentNumber: '', notes: '', file: null }]);
                    setIsAddingCommittee(true);
                  }}
                  className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-6 py-3 rounded-xl font-bold transition-all shadow-lg shadow-emerald-100 dark:shadow-none hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0"
                >
                  <Plus className="w-5 h-5" />
                  បន្ថែមព័ត៌មាន
                </button>
              )}
            </div>
            
            <CommitteesTable 
              committees={committees}
              onEdit={(group) => {
                setEditingCommittee(group[0]);
                setCommitteeRows(group.map(c => ({ 
                  id: c.id, 
                  objective: c.objective, 
                  ministry: c.ministry || '', 
                  documentNumber: c.documentNumber || '', 
                  notes: c.notes || '', 
                  file: null, 
                  fileUrl: c.fileUrl 
                })));
                setIsAddingCommittee(true);
              }}
              onDelete={handleDeleteCommittee}
              isEditor={isEditor}
              onViewFile={handleViewFile}
              showToast={showToast}
              onSharePreview={setSharePreviewGroup}
            />
          </div>
        )}
        {/* Share Preview Modal */}
        <AnimatePresence>
          {sharePreviewGroup && (
            <SharePreviewModal 
              group={sharePreviewGroup} 
              onClose={() => setSharePreviewGroup(null)} 
              showToast={showToast}
            />
          )}
        </AnimatePresence>

        {/* User Management Modal */}
        <AnimatePresence>
          {isManagingUsers && isAdmin && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsManagingUsers(false)}
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl w-full max-w-4xl relative z-10 overflow-hidden flex flex-col max-h-[90vh] border border-gray-100 dark:border-gray-800"
              >
                <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-white dark:bg-gray-900 sticky top-0 z-20">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                      <Users className="text-blue-600 w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold">គ្រប់គ្រងអ្នកប្រើប្រាស់</h3>
                      <p className="text-xs text-gray-500">កំណត់សិទ្ធិ និងតួនាទីសម្រាប់អ្នកប្រើប្រាស់</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => {
                        setIsCreatingUser(!isCreatingUser);
                        setAuthError(null);
                      }}
                      className={cn(
                        "flex items-center gap-2 px-4 py-2 rounded-xl font-bold text-sm transition-all",
                        isCreatingUser 
                          ? "bg-gray-100 text-gray-600 hover:bg-gray-200" 
                          : "bg-blue-600 text-white hover:bg-blue-700 shadow-md shadow-blue-100"
                      )}
                    >
                      {isCreatingUser ? <X className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
                      {isCreatingUser ? 'បោះបង់' : 'បង្កើតអ្នកប្រើប្រាស់'}
                    </button>
                    <button onClick={() => setIsManagingUsers(false)} className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6">
                  <AnimatePresence mode="wait">
                    {isCreatingUser ? (
                      <motion.div
                        key="create-user"
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -20 }}
                        className="max-w-md mx-auto"
                      >
                        <div className="bg-gray-50 p-6 rounded-3xl border border-gray-100 space-y-5">
                          <div className="text-center mb-6">
                            <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center mx-auto mb-3">
                              <UserPlus className="text-blue-600 w-6 h-6" />
                            </div>
                            <h4 className="font-bold text-gray-900">បង្កើតគណនីថ្មី</h4>
                            <p className="text-xs text-gray-500">បញ្ចូលព័ត៌មានដើម្បីបង្កើតអ្នកប្រើប្រាស់</p>
                          </div>

                          <form onSubmit={handleCreateUser} className="space-y-4">
                            <div>
                              <label className="block text-xs font-bold text-gray-700 mb-1.5 ml-1">ឈ្មោះពេញ</label>
                              <div className="relative">
                                <UserIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input 
                                  type="text" 
                                  value={newUserName}
                                  onChange={e => setNewUserName(e.target.value)}
                                  required
                                  className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm"
                                  placeholder="ឈ្មោះអ្នកប្រើប្រាស់"
                                />
                              </div>
                            </div>

                            <div>
                              <label className="block text-xs font-bold text-gray-700 mb-1.5 ml-1">អ៊ីមែល</label>
                              <div className="relative">
                                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input 
                                  type="email" 
                                  value={newUserEmail}
                                  onChange={e => setNewUserEmail(e.target.value)}
                                  required
                                  className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm"
                                  placeholder="example@email.com"
                                />
                              </div>
                            </div>

                            <div>
                              <label className="block text-xs font-bold text-gray-700 mb-1.5 ml-1">ពាក្យសម្ងាត់</label>
                              <div className="relative">
                                <Key className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input 
                                  type="password" 
                                  value={newUserPassword}
                                  onChange={e => setNewUserPassword(e.target.value)}
                                  required
                                  className="w-full pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm"
                                  placeholder="••••••••"
                                />
                              </div>
                            </div>

                            <div>
                              <label className="block text-xs font-bold text-gray-700 mb-1.5 ml-1">តួនាទី</label>
                              <div className="grid grid-cols-3 gap-2">
                                {(['viewer', 'editor', 'admin'] as const).map(role => (
                                  <button
                                    key={role}
                                    type="button"
                                    onClick={() => setNewUserRole(role)}
                                    className={cn(
                                      "py-2 rounded-xl text-[10px] font-bold border transition-all",
                                      newUserRole === role 
                                        ? "bg-blue-600 border-blue-600 text-white" 
                                        : "bg-white border-gray-200 text-gray-500 hover:border-blue-300"
                                    )}
                                  >
                                    {role === 'admin' ? 'អ្នកគ្រប់គ្រង' : role === 'editor' ? 'អ្នកកែសម្រួល' : 'អ្នកមើល'}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {authError && (
                              <div className="p-3 bg-red-50 border border-red-100 text-red-600 text-[10px] font-bold rounded-xl flex items-center gap-2">
                                <AlertCircle className="w-3.5 h-3.5" />
                                {authError}
                              </div>
                            )}

                            <button
                              type="submit"
                              disabled={isAuthLoading}
                              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 rounded-xl transition-all shadow-lg shadow-blue-100 flex items-center justify-center gap-2 disabled:opacity-50 mt-2"
                            >
                              {isAuthLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                              បង្កើតគណនី
                            </button>
                          </form>
                        </div>
                      </motion.div>
                    ) : (
                      <motion.div
                        key="user-list"
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 20 }}
                        className="overflow-hidden rounded-xl border border-gray-200 shadow-sm"
                      >
                        <table className="w-full border-collapse text-sm">
                          <thead>
                            <tr className="bg-gray-50 border-b border-gray-200">
                              <th className="p-4 text-left font-semibold text-gray-600">អ្នកប្រើប្រាស់</th>
                              <th className="p-4 text-left font-semibold text-gray-600">អ៊ីមែល</th>
                              <th className="p-4 text-center font-semibold text-gray-600">តួនាទី</th>
                              <th className="p-4 text-center font-semibold text-gray-600">សកម្មភាព</th>
                            </tr>
                          </thead>
                          <tbody>
                            {allUsers.map((u) => (
                              <tr key={u.uid} className="border-b border-gray-100 hover:bg-gray-50/50 transition-colors">
                                <td className="p-4">
                                  <div className="flex items-center gap-3">
                                    <img src={u.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.displayName || 'User')}&background=random`} alt="" className="w-8 h-8 rounded-full border border-gray-200" />
                                    <span className="font-bold text-gray-900">{u.displayName}</span>
                                  </div>
                                </td>
                                <td className="p-4 text-gray-600">{u.email}</td>
                                <td className="p-4 text-center">
                                  <span className={cn(
                                    "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                                    u.role === 'admin' ? "bg-purple-100 text-purple-700" :
                                    u.role === 'editor' ? "bg-blue-100 text-blue-700" :
                                    "bg-gray-100 text-gray-700"
                                  )}>
                                    {u.role === 'admin' ? 'អ្នកគ្រប់គ្រង' : u.role === 'editor' ? 'អ្នកកែសម្រួល' : 'អ្នកមើល'}
                                  </span>
                                </td>
                                <td className="p-4">
                                  <div className="flex items-center justify-center gap-2">
                                    <select 
                                      value={u.role}
                                      onChange={(e) => updateUserRole(u.uid, e.target.value as any)}
                                      disabled={u.email === 'lasediii.info@gmail.com'}
                                      className="text-xs border border-gray-200 rounded-lg px-2 py-1 outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                                    >
                                      <option value="viewer">អ្នកមើល</option>
                                      <option value="editor">អ្នកកែសម្រួល</option>
                                      <option value="admin">អ្នកគ្រប់គ្រង</option>
                                    </select>
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Add/Edit Committee Modal */}
        <AnimatePresence>
          {(isAddingCommittee || editingCommittee) && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => {
                  setIsAddingCommittee(false);
                  setEditingCommittee(null);
                  setNewCommittee({
                    leaderName: '',
                    leaderPosition: '',
                    documentNumber: '',
                    objective: '',
                    ministry: '',
                    fileUrl: '',
                    notes: '',
                    order: 0
                  });
                  setCommitteeRows([{ id: Math.random().toString(36).substr(2, 9), objective: '', ministry: '', documentNumber: '', notes: '', file: null }]);
                }}
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl dark:shadow-none border border-gray-200 dark:border-gray-800 w-full max-w-5xl relative z-10 overflow-hidden"
              >
                <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg flex items-center justify-center">
                      <Plus className="text-emerald-600 dark:text-emerald-400 w-6 h-6" />
                    </div>
                    <h3 className="text-xl font-bold dark:text-white">
                      {editingCommittee ? 'កែសម្រួលព័ត៌មាន' : 'បន្ថែមព័ត៌មានថ្មី'}
                    </h3>
                  </div>
                  <button 
                    onClick={() => {
                      setIsAddingCommittee(false);
                      setEditingCommittee(null);
                      setCommitteeRows([{ id: Math.random().toString(36).substr(2, 9), objective: '', ministry: '', documentNumber: '', notes: '', file: null }]);
                    }} 
                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors text-gray-500 dark:text-gray-400"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="p-6 space-y-6 max-h-[75vh] overflow-y-auto scrollbar-hide">
                  <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-2xl border border-gray-100 dark:border-gray-800">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">ឈ្មោះថ្នាក់ដឹកនាំ</label>
                        <input 
                          type="text" 
                          value={editingCommittee ? editingCommittee.leaderName : newCommittee.leaderName}
                          onChange={e => {
                            if (editingCommittee) setEditingCommittee({...editingCommittee, leaderName: e.target.value});
                            else setNewCommittee({...newCommittee, leaderName: e.target.value});
                          }}
                          className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
                          placeholder="បញ្ចូលឈ្មោះ..."
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-1.5">តួនាទី</label>
                        <input 
                          type="text" 
                          value={editingCommittee ? editingCommittee.leaderPosition : newCommittee.leaderPosition}
                          onChange={e => {
                            if (editingCommittee) setEditingCommittee({...editingCommittee, leaderPosition: e.target.value});
                            else setNewCommittee({...newCommittee, leaderPosition: e.target.value});
                          }}
                          className="w-full px-4 py-2.5 border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition-all"
                          placeholder="បញ្ចូលតួនាទី..."
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-bold text-gray-700 dark:text-gray-300">ព័ត៌មានលម្អិត</h4>
                      <button 
                        onClick={() => setCommitteeRows([...committeeRows, { id: Math.random().toString(36).substr(2, 9), objective: '', ministry: '', documentNumber: '', notes: '', file: null }])}
                        disabled={isUploadingCommitteeFile}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-lg text-xs font-bold border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 transition-all disabled:opacity-50"
                      >
                        <Plus className="w-3.5 h-3.5" /> ចុចបន្ថែមជួរដេក
                      </button>
                    </div>

                    <div className="space-y-3">
                      {committeeRows.map((row, index) => (
                        <div key={row.id} className="p-4 border border-gray-100 dark:border-gray-800 rounded-xl hover:border-emerald-100 dark:hover:border-emerald-900/30 transition-all relative group">
                          <div className="grid grid-cols-12 gap-3 items-start">
                            <div className="col-span-12 md:col-span-3">
                              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">កម្មវត្ថុ</label>
                              <textarea 
                                value={row.objective}
                                onChange={e => {
                                  setCommitteeRows(committeeRows.map(r => r.id === row.id ? {...r, objective: e.target.value} : r));
                                }}
                                rows={1}
                                className="w-full px-3 py-2 border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-xs transition-all"
                                placeholder="បញ្ចូលកម្មវត្ថុ..."
                              />
                            </div>
                            <div className="col-span-6 md:col-span-2">
                              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">ក្រសួង</label>
                              <input 
                                type="text" 
                                value={row.ministry}
                                onChange={e => {
                                  setCommitteeRows(committeeRows.map(r => r.id === row.id ? {...r, ministry: e.target.value} : r));
                                }}
                                className="w-full px-3 py-2 border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-xs transition-all"
                                placeholder="ក្រសួង..."
                              />
                            </div>
                            <div className="col-span-6 md:col-span-2">
                              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">លេខលិខិត</label>
                              <input 
                                type="text" 
                                value={row.documentNumber}
                                onChange={e => {
                                  setCommitteeRows(committeeRows.map(r => r.id === row.id ? {...r, documentNumber: e.target.value} : r));
                                }}
                                className="w-full px-3 py-2 border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-xs transition-all"
                                placeholder="លេខលិខិត..."
                              />
                            </div>
                            <div className="col-span-6 md:col-span-2">
                              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">ឯកសារ</label>
                              <div className="flex items-center gap-1.5">
                                <label className="flex-1 flex items-center gap-1.5 px-2 py-2 border border-dashed border-gray-200 dark:border-gray-700 rounded-lg hover:border-emerald-500 transition-all cursor-pointer overflow-hidden">
                                  <Upload className="w-3 h-3 text-gray-400 shrink-0" />
                                  <span className="text-[9px] text-gray-500 truncate">
                                    {row.file ? row.file.name : (row.fileUrl ? 'មានឯកសារ' : 'ជ្រើសរើស')}
                                  </span>
                                  <input 
                                    type="file" 
                                    className="hidden" 
                                    onChange={e => {
                                      const file = e.target.files?.[0] || null;
                                      if (file && file.size > 10 * 1024 * 1024) { // 10MB limit
                                        showToast('ឯកសារធំពេក (អតិបរមា 10MB)', 'error');
                                        e.target.value = '';
                                        return;
                                      }
                                      setCommitteeRows(committeeRows.map(r => r.id === row.id ? {...r, file} : r));
                                    }}
                                  />
                                </label>
                                {row.fileUrl && !row.file && (
                                  <button 
                                    onClick={() => handleViewFile(row.fileUrl!)}
                                    className="p-1.5 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 rounded-md hover:bg-blue-100 transition-all cursor-pointer"
                                    title="មើលឯកសារចាស់"
                                  >
                                    <FileText className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="col-span-5 md:col-span-2">
                              <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">ផ្សេងៗ</label>
                              <input 
                                type="text" 
                                value={row.notes}
                                onChange={e => {
                                  setCommitteeRows(committeeRows.map(r => r.id === row.id ? {...r, notes: e.target.value} : r));
                                }}
                                className="w-full px-3 py-2 border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 rounded-lg focus:ring-2 focus:ring-emerald-500 outline-none text-xs transition-all"
                                placeholder="ផ្សេងៗ..."
                              />
                            </div>
                            <div className="col-span-1 flex items-end justify-center pb-1.5">
                              {committeeRows.length > 1 && (
                                <button 
                                  onClick={() => setCommitteeRows(committeeRows.filter(r => r.id !== row.id))}
                                  className="w-7 h-7 bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400 rounded-lg flex items-center justify-center hover:bg-red-100 dark:hover:bg-red-900/40 transition-all"
                                  title="លុបជួរដេក"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}

                      <button 
                        onClick={() => setCommitteeRows([...committeeRows, { id: Math.random().toString(36).substr(2, 9), objective: '', ministry: '', documentNumber: '', notes: '', file: null }])}
                        disabled={isUploadingCommitteeFile}
                        className="w-full py-3 border-2 border-dashed border-gray-200 dark:border-gray-700 rounded-xl text-gray-500 dark:text-gray-400 font-bold hover:border-emerald-500 hover:text-emerald-600 hover:bg-emerald-50/30 transition-all flex items-center justify-center gap-2 mt-2"
                      >
                        <Plus className="w-5 h-5" /> ចុចបន្ថែមជួរដេក
                      </button>
                    </div>
                  </div>
                </div>

                <div className="p-6 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 flex gap-3">
                  <button 
                    onClick={() => {
                      setIsAddingCommittee(false);
                      setEditingCommittee(null);
                    }}
                    className="flex-1 px-4 py-2.5 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 rounded-xl font-bold hover:bg-gray-100 dark:hover:bg-gray-800 transition-all"
                    disabled={isUploadingCommitteeFile}
                  >
                    បោះបង់
                  </button>
                  <button 
                    onClick={editingCommittee ? handleEditCommittee : handleAddCommittee}
                    disabled={isUploadingCommitteeFile}
                    className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-xl font-bold hover:bg-emerald-700 shadow-lg shadow-emerald-100 dark:shadow-none transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isUploadingCommitteeFile ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <Save className="w-5 h-5" />
                    )}
                    {isUploadingCommitteeFile ? 'កំពុងរក្សាទុក...' : (editingCommittee ? 'រក្សាទុក' : 'បន្ថែម')}
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Group Management Modal */}
        <AnimatePresence>
          {isManagingGroups && isAdmin && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsManagingGroups(false)}
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl dark:shadow-none border border-gray-200 dark:border-gray-800 w-full max-w-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh]"
              >
                <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-white dark:bg-gray-900 sticky top-0 z-20">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                      <Layout className="text-blue-600 dark:text-blue-400 w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold dark:text-white">គ្រប់គ្រងប្រភេទក្រុម</h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400">បន្ថែម កែសម្រួល ឬលុបប្រភេទក្រុមមន្ត្រី</p>
                    </div>
                  </div>
                  <button onClick={() => setIsManagingGroups(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors text-gray-500 dark:text-gray-400">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="p-6 bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">
                  <div className="flex gap-3">
                    <input 
                      type="text" 
                      value={newGroupName}
                      onChange={e => setNewGroupName(e.target.value)}
                      placeholder="បញ្ចូលឈ្មោះក្រុមថ្មី..."
                      className="flex-1 px-4 py-2.5 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm text-gray-900 dark:text-gray-100"
                    />
                    <button 
                      onClick={editingGroup ? handleEditGroup : handleAddGroup}
                      className="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 shadow-md shadow-blue-100 dark:shadow-none transition-all flex items-center gap-2 shrink-0"
                    >
                      {editingGroup ? <Save className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                      {editingGroup ? 'រក្សាទុក' : 'បន្ថែម'}
                    </button>
                    {editingGroup && (
                      <button 
                        onClick={() => {
                          setEditingGroup(null);
                          setNewGroupName('');
                        }}
                        className="px-4 py-2.5 bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-xl font-bold text-sm hover:bg-gray-300 dark:hover:bg-gray-600 transition-all"
                      >
                        បោះបង់
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6">
                  <div className="space-y-2">
                    {groups.map((group, index) => (
                      <div 
                        key={group.id}
                        className="flex items-center justify-between p-4 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl hover:border-blue-200 dark:hover:border-blue-800 hover:shadow-sm transition-all group"
                      >
                        <div className="flex items-center gap-4">
                          <div className="w-8 h-8 bg-gray-50 dark:bg-gray-800 rounded-lg flex items-center justify-center text-xs font-bold text-gray-400 dark:text-gray-500">
                            {index + 1}
                          </div>
                          <span className="font-bold text-gray-700 dark:text-gray-300">{group.name}</span>
                        </div>
                        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button 
                            onClick={() => {
                              setEditingGroup(group);
                              setNewGroupName(group.name);
                            }}
                            className="p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                            title="កែសម្រួល"
                          >
                            <Settings className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => setDeletingGroupId(group.id)}
                            className="p-2 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                            title="លុប"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                    {groups.length === 0 && (
                      <div className="text-center py-12">
                        <div className="w-16 h-16 bg-gray-50 dark:bg-gray-800 rounded-full flex items-center justify-center mx-auto mb-4">
                          <Layout className="w-8 h-8 text-gray-300 dark:text-gray-600" />
                        </div>
                        <p className="text-gray-500 dark:text-gray-400">មិនទាន់មានក្រុមនៅឡើយទេ</p>
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
        <AnimatePresence>
          {isBulkEditing && isEditor && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setIsBulkEditing(false)}
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl dark:shadow-none border border-gray-200 dark:border-gray-800 w-full max-w-4xl relative z-10 overflow-hidden flex flex-col max-h-[90vh]"
              >
                <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-white dark:bg-gray-900 sticky top-0 z-20">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center">
                      <FileText className="text-purple-600 dark:text-purple-400 w-6 h-6" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold dark:text-white">កែសម្រួលកំណត់ចំណាំជាក្រុម</h3>
                      <p className="text-xs text-gray-500 dark:text-gray-400">អនុវត្តកំណត់ចំណាំចំពោះមន្ត្រី និងថ្ងៃដែលបានជ្រើសរើស</p>
                    </div>
                  </div>
                  <button onClick={() => setIsBulkEditing(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors text-gray-500 dark:text-gray-400">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                  {/* Selected Officials */}
                  <div>
                    <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-3">មន្ត្រីដែលបានជ្រើសរើស ({selectedOfficialIds.length})</label>
                    <div className="flex flex-wrap gap-2 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700">
                      {selectedOfficialIds.map(id => {
                        const official = officials.find(o => o.id === id);
                        return (
                          <div key={id} className="flex items-center gap-2 bg-white dark:bg-gray-800 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm text-xs font-medium dark:text-gray-200">
                            <span>{official?.name}</span>
                            <button 
                              onClick={() => toggleOfficialSelection(id)}
                              className="text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Day Selection */}
                    <div>
                      <div className="flex items-center justify-between mb-3">
                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-300">ជ្រើសរើសថ្ងៃ ({selectedDays.length})</label>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => setSelectedDays(daysArray)}
                            className="text-[10px] uppercase font-bold text-brand dark:text-brand-light hover:underline"
                          >
                            ទាំងអស់
                          </button>
                          <button 
                            onClick={() => {
                              const weekdays = daysArray.filter(d => {
                                const date = new Date(getYear(currentDate), getMonth(currentDate), d);
                                return ![0, 6].includes(date.getDay());
                              });
                              setSelectedDays(weekdays);
                            }}
                            className="text-[10px] uppercase font-bold text-brand dark:text-brand-light hover:underline"
                          >
                            ថ្ងៃធ្វើការ
                          </button>
                          <button 
                            onClick={() => setSelectedDays([])}
                            className="text-[10px] uppercase font-bold text-red-600 dark:text-red-400 hover:underline"
                          >
                            សម្អាត
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-7 gap-1 p-3 bg-gray-50 dark:bg-gray-800/50 rounded-xl border border-gray-200 dark:border-gray-700">
                        {daysArray.map(day => {
                          const isSelected = selectedDays.includes(day);
                          const isWeekend = [0, 6].includes(new Date(getYear(currentDate), getMonth(currentDate), day).getDay());
                          return (
                            <button
                              key={day}
                              onClick={() => setSelectedDays(prev => 
                                prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
                              )}
                              className={cn(
                                "h-10 rounded-lg flex items-center justify-center text-sm font-bold transition-all border",
                                isSelected 
                                  ? "bg-brand text-white border-brand shadow-md scale-105 z-10" 
                                  : isWeekend 
                                    ? "bg-brand-light/50 dark:bg-brand-light/10 text-brand/60 dark:text-brand-light/60 border-brand-shadow dark:border-brand-shadow/30 hover:border-brand-shadow" 
                                    : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700 hover:border-brand"
                              )}
                            >
                              {day}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Note Content */}
                    <div>
                      <label className="block text-sm font-bold text-gray-700 dark:text-gray-300 mb-3">ខ្លឹមសារកំណត់ចំណាំ</label>
                      <div className="quill-editor-container bulk-editor dark:bg-gray-800 dark:text-gray-200 rounded-xl overflow-hidden border dark:border-gray-700">
                        <ReactQuill 
                          theme="snow"
                          value={bulkNoteText}
                          onChange={setBulkNoteText}
                          placeholder="បញ្ចូលព័ត៌មានបេសកកម្មសម្រាប់ថ្ងៃដែលបានជ្រើសរើស..."
                          modules={{
                            toolbar: [
                              ['bold', 'italic', 'underline'],
                              [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                              ['clean']
                            ],
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="p-6 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 flex items-center justify-between">
                  <div className="text-xs text-gray-500 dark:text-gray-400">
                    <span className="font-bold text-purple-600 dark:text-purple-400">សម្គាល់៖</span> ការរក្សាទុកនឹងជំនួសកំណត់ចំណាំចាស់ៗលើថ្ងៃដែលបានជ្រើសរើស។
                  </div>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setIsBulkEditing(false)}
                      className="px-6 py-2.5 rounded-xl font-bold text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-all"
                    >
                      បោះបង់
                    </button>
                    <button
                      onClick={handleBulkUpdateNotes}
                      disabled={selectedOfficialIds.length === 0 || selectedDays.length === 0}
                      className="flex items-center gap-2 bg-brand hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed text-white px-8 py-2.5 rounded-xl font-bold transition-all shadow-lg hover:shadow-xl"
                    >
                      <Save className="w-5 h-5" />
                      រក្សាទុកទាំងអស់
                    </button>
                  </div>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>

        {/* Edit Official Modal */}
        <AnimatePresence>
          {editingOfficial && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setEditingOfficial(null)}
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              />
              <motion.div 
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl dark:shadow-none border border-gray-200 dark:border-gray-800 w-full max-w-md relative z-10 overflow-hidden"
              >
                <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-brand-light dark:bg-brand-light/10 rounded-lg flex items-center justify-center">
                      <UserPlus className="text-brand dark:text-brand-light w-6 h-6" />
                    </div>
                    <h3 className="text-xl font-bold dark:text-white">កែសម្រួលព័ត៌មានមន្ត្រី</h3>
                  </div>
                  <button onClick={() => setEditingOfficial(null)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors text-gray-500 dark:text-gray-400">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="p-6 space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ឈ្មោះ</label>
                    <input 
                      type="text" 
                      value={editingOfficial.name}
                      onChange={e => setEditingOfficial({...editingOfficial, name: e.target.value})}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-xl focus:ring-2 focus:ring-brand focus:border-transparent outline-none transition-all"
                      placeholder="បញ្ចូលឈ្មោះមន្ត្រី"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ភេទ</label>
                      <select 
                        value={editingOfficial.gender}
                        onChange={e => setEditingOfficial({...editingOfficial, gender: e.target.value as 'M' | 'F'})}
                        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                      >
                        <option value="M">ប្រុស</option>
                        <option value="F">ស្រី</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ក្រុម</label>
                      <select 
                        value={getGroupNameKh(editingOfficial.group)}
                        onChange={e => setEditingOfficial({...editingOfficial, group: e.target.value})}
                        className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                      >
                        {uniqueGroups.map(group => (
                          <option key={group} value={group}>{group}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">តួនាទី</label>
                    <input 
                      type="text" 
                      value={editingOfficial.position}
                      onChange={e => setEditingOfficial({...editingOfficial, position: e.target.value})}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                      placeholder="បញ្ចូលតួនាទី"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ការពិពណ៌នាអំពីក្រុម (ជម្រើស)</label>
                    <textarea 
                      value={editingOfficial.groupDescription || ''}
                      onChange={e => setEditingOfficial({...editingOfficial, groupDescription: e.target.value})}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all resize-none h-20"
                      placeholder="បញ្ចូលការពិពណ៌នាបន្ថែមអំពីក្រុម ឬការិយាល័យ"
                    />
                  </div>
                </div>

                <div className="p-6 border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 flex gap-3">
                  <button
                    onClick={() => setEditingOfficial(null)}
                    className="flex-1 px-4 py-2.5 rounded-xl font-bold text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 transition-all"
                  >
                    បោះបង់
                  </button>
                  <button
                    onClick={handleUpdateOfficial}
                    className="flex-1 bg-brand hover:bg-brand-hover text-white px-4 py-2.5 rounded-xl font-bold transition-all shadow-lg hover:shadow-xl"
                  >
                    រក្សាទុក
                  </button>
                </div>
              </motion.div>
            </div>
          )}
        </AnimatePresence>
      </main>

      {/* Add Official Modal */}
      <AnimatePresence>
        {isAddingOfficial && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAddingOfficial(false)}
              className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl dark:shadow-none border border-gray-200 dark:border-gray-800 w-full max-w-md relative z-10 overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                <h3 className="text-xl font-bold dark:text-white">បន្ថែមមន្ត្រីថ្មី</h3>
                <button onClick={() => setIsAddingOfficial(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg text-gray-500 dark:text-gray-400">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ឈ្មោះពេញ</label>
                  <input 
                    type="text" 
                    value={newOfficial.name}
                    onChange={e => setNewOfficial({...newOfficial, name: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-xl focus:ring-2 focus:ring-brand focus:border-transparent outline-none transition-all"
                    placeholder="បញ្ចូលឈ្មោះ"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ភេទ</label>
                    <select 
                      value={newOfficial.gender}
                      onChange={e => setNewOfficial({...newOfficial, gender: e.target.value as any})}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-xl focus:ring-2 focus:ring-brand focus:border-transparent outline-none transition-all"
                    >
                      <option value="M">ប្រុស (ប)</option>
                      <option value="F">ស្រី (ស)</option>
                      <option value="Other">ផ្សេងៗ</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ក្រុម</label>
                    <select 
                      value={getGroupNameKh(newOfficial.group)}
                      onChange={e => setNewOfficial({...newOfficial, group: e.target.value})}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-xl focus:ring-2 focus:ring-brand focus:border-transparent outline-none transition-all"
                    >
                      <option value="">ជ្រើសរើសក្រុម</option>
                      {uniqueGroups.map(group => (
                        <option key={group} value={group}>{group}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">តួនាទី</label>
                  <input 
                    type="text" 
                    value={newOfficial.position}
                    onChange={e => setNewOfficial({...newOfficial, position: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-xl focus:ring-2 focus:ring-brand focus:border-transparent outline-none transition-all"
                    placeholder="បញ្ចូលតួនាទី"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">ការពិពណ៌នាអំពីក្រុម (ជម្រើស)</label>
                  <textarea 
                    value={newOfficial.groupDescription || ''}
                    onChange={e => setNewOfficial({...newOfficial, groupDescription: e.target.value})}
                    className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-xl focus:ring-2 focus:ring-brand focus:border-transparent outline-none transition-all resize-none h-20"
                    placeholder="បញ្ចូលការពិពណ៌នាបន្ថែមអំពីក្រុម ឬការិយាល័យ"
                  />
                </div>
              </div>
              <div className="p-6 bg-gray-50 dark:bg-gray-800/50 flex gap-3">
                <button 
                  onClick={() => setIsAddingOfficial(false)}
                  className="flex-1 px-4 py-2.5 border border-gray-300 dark:border-gray-700 rounded-xl font-medium text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800 transition-all"
                >
                  បោះបង់
                </button>
                <button 
                  onClick={handleAddOfficial}
                  className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-all shadow-sm"
                >
                  រក្សាទុកមន្ត្រី
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Bulk Import Modal */}
      <AnimatePresence>
        {isImporting && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsImporting(false)}
              className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl dark:shadow-none border border-gray-200 dark:border-gray-800 w-full max-w-2xl relative z-10 overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                    <FileUp className="text-blue-600 dark:text-blue-400 w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold dark:text-white">នាំចូលមន្ត្រីជាក្រុម</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">បិទភ្ជាប់បញ្ជីឈ្មោះមន្ត្រីច្រើនក្នុងពេលតែមួយ</p>
                  </div>
                </div>
                <button onClick={() => setIsImporting(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg text-gray-500 dark:text-gray-400">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-xl border border-blue-100 dark:border-blue-900/30">
                  <h4 className="text-sm font-bold text-blue-800 dark:text-blue-300 mb-1 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" />
                    ការណែនាំ
                  </h4>
                  <p className="text-xs text-blue-700 dark:text-blue-400 leading-relaxed">
                    អ្នកអាចផ្ទុកឡើងឯកសារ Excel ឬបិទភ្ជាប់អត្ថបទ។ ជួរឈរគួរតែមាន៖<br />
                    <code className="font-mono bg-white dark:bg-gray-800 px-1 rounded border border-blue-200 dark:border-blue-800">១. ល.រ, ២. ឈ្មោះ, ៣. ភេទ, ៤. តួនាទី</code><br />
                    ភេទ៖ <code className="font-mono text-gray-500 dark:text-gray-400">ប (ប្រុស) / ស (ស្រី)</code>
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">ចាត់ចូលក្រុម</label>
                    <select 
                      value={getGroupNameKh(importGroup)}
                      onChange={e => setImportGroup(e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                    >
                      {uniqueGroups.map(group => (
                        <option key={group} value={group}>{group}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">ផ្ទុកឡើង Excel</label>
                    <div className="relative">
                      <input 
                        type="file" 
                        accept=".xlsx, .xls"
                        onChange={e => setImportFile(e.target.files?.[0] || null)}
                        className="hidden"
                        id="excel-upload"
                      />
                      <label 
                        htmlFor="excel-upload"
                        className={cn(
                          "w-full px-4 py-2 border border-dashed border-gray-300 dark:border-gray-700 rounded-xl flex items-center justify-center gap-2 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 transition-all",
                          importFile && "border-blue-500 dark:border-blue-400 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300"
                        )}
                      >
                        <FileSpreadsheet className="w-5 h-5" />
                        <span className="dark:text-gray-300">{importFile ? importFile.name : 'ជ្រើសរើសឯកសារ Excel'}</span>
                      </label>
                    </div>
                  </div>
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center" aria-hidden="true">
                    <div className="w-full border-t border-gray-200 dark:border-gray-800"></div>
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-white dark:bg-gray-900 text-gray-500 dark:text-gray-400">ឬបិទភ្ជាប់អត្ថបទ</span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">ទិន្នន័យ (ទម្រង់ CSV)</label>
                  <textarea 
                    value={importText}
                    onChange={e => setImportText(e.target.value)}
                    disabled={!!importFile}
                    className="w-full h-48 px-4 py-3 border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all font-mono text-sm disabled:bg-gray-50 dark:disabled:bg-gray-900 disabled:text-gray-400 dark:disabled:text-gray-600"
                    placeholder="ឈ្មោះ, តួនាទី, ក្រុម, ភេទ&#10;ឈ្មោះ, តួនាទី, ក្រុម, ភេទ"
                  />
                </div>
              </div>
              <div className="p-6 bg-gray-50 dark:bg-gray-800/50 flex gap-3">
                <button 
                  onClick={() => setIsImporting(false)}
                  className="flex-1 px-4 py-2.5 border border-gray-300 dark:border-gray-700 rounded-xl font-medium text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800 transition-all"
                >
                  បោះបង់
                </button>
                <button 
                  onClick={handleBulkImport}
                  className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-all shadow-sm flex items-center justify-center gap-2"
                >
                  <Upload className="w-5 h-5" />
                  នាំចូលឥឡូវនេះ
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Note Modal */}
      <AnimatePresence>
        {editingNote && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setEditingNote(null)}
              className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl dark:shadow-none border border-gray-200 dark:border-gray-800 w-full max-w-md relative z-10 overflow-hidden"
            >
              <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-white dark:bg-gray-900 sticky top-0 z-20">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                    <MessageSquare className="text-blue-600 dark:text-blue-400 w-6 h-6 fill-blue-600" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold dark:text-white">កត់ត្រាថ្ងៃទី {editingNote.day}</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">
                      {officials.find(o => o.id === editingNote.officialId)?.name}
                    </p>
                  </div>
                </div>
                <button onClick={() => setEditingNote(null)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg text-gray-500 dark:text-gray-400">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">ខ្លឹមសារកំណត់ចំណាំ</label>
                <div className="quill-editor-container">
                  <ReactQuill 
                    theme="snow"
                    value={editingNote.text}
                    onChange={text => setEditingNote({...editingNote, text})}
                    placeholder="បញ្ចូលព័ត៌មានបេសកកម្ម ទីកន្លែង ឬគោលបំណង..."
                    modules={{
                      toolbar: [
                        ['bold', 'italic', 'underline'],
                        [{ 'list': 'ordered'}, { 'list': 'bullet' }],
                        ['clean']
                      ],
                    }}
                  />
                </div>
                <style>{`
                  .quill-editor-container .ql-container {
                    height: 150px;
                    font-size: 0.875rem;
                    border-bottom-left-radius: 0.75rem;
                    border-bottom-right-radius: 0.75rem;
                  }
                  .quill-editor-container .ql-toolbar {
                    border-top-left-radius: 0.75rem;
                    border-top-right-radius: 0.75rem;
                    background-color: #f9fafb;
                  }
                  .dark .quill-editor-container .ql-toolbar {
                    background-color: #111827;
                    border-color: #374151;
                  }
                  .dark .quill-editor-container .ql-container {
                    border-color: #374151;
                    color: #f3f4f6;
                  }
                  .dark .ql-snow .ql-stroke {
                    stroke: #9ca3af;
                  }
                  .dark .ql-snow .ql-fill {
                    fill: #9ca3af;
                  }
                  .dark .ql-snow .ql-picker {
                    color: #9ca3af;
                  }
                `}</style>
              </div>
              <div className="p-6 bg-gray-50 dark:bg-gray-800/50 flex gap-3">
                {missions.find(m => m.officialId === editingNote.officialId && m.month === (getMonth(currentDate) + 1) && m.year === getYear(currentDate))?.days.includes(editingNote.day) && (
                  <button 
                    onClick={() => deleteMissionDay(editingNote.officialId, editingNote.day)}
                    disabled={isDeletingMission || isSavingNote}
                    className="px-4 py-2.5 bg-red-50 dark:bg-red-900/10 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 rounded-xl font-medium hover:bg-red-100 dark:hover:bg-red-900/30 transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {isDeletingMission ? (
                      <div className="w-5 h-5 border-2 border-red-600 dark:border-red-400 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Trash2 className="w-5 h-5" />
                    )}
                    លុបបេសកកម្ម
                  </button>
                )}
                <div className="flex-1" />
                <button 
                  onClick={() => setEditingNote(null)}
                  disabled={isDeletingMission || isSavingNote}
                  className="px-4 py-2.5 border border-gray-300 dark:border-gray-700 rounded-xl font-medium text-gray-700 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800 transition-all disabled:opacity-50"
                >
                  បោះបង់
                </button>
                <button 
                  onClick={updateMissionNote}
                  disabled={isDeletingMission || isSavingNote}
                  className="px-6 py-2.5 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {isSavingNote ? (
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Save className="w-5 h-5" />
                  )}
                  រក្សាទុកកំណត់ចំណាំ
                </button>
              </div>
            </motion.div>
          </div>
        )}
        {/* Delete Confirmation Modal */}
        {deletingOfficialId && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl dark:shadow-none border border-gray-200 dark:border-gray-800 max-w-md w-full overflow-hidden"
            >
              <div className="p-6 text-center">
                <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mx-auto mb-4">
                  <AlertTriangle className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">បញ្ជាក់ការលុប</h3>
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                  តើអ្នកពិតជាចង់លុបមន្ត្រីនេះមែនទេ? រាល់ទិន្នន័យបេសកកម្មទាំងអស់របស់មន្ត្រីនេះនឹងត្រូវលុបចេញពីប្រព័ន្ធ។
                </p>
                <div className="flex gap-3">
                  <button 
                    onClick={() => setDeletingOfficialId(null)}
                    className="flex-1 px-4 py-2.5 border border-gray-300 dark:border-gray-700 rounded-xl font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-all"
                  >
                    បោះបង់
                  </button>
                  <button 
                    onClick={() => handleDeleteOfficial(deletingOfficialId)}
                    className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition-all shadow-sm"
                  >
                    លុបចេញ
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}

        {/* Group Delete Confirmation Modal */}
        {deletingGroupId && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl dark:shadow-none border border-gray-200 dark:border-gray-800 max-w-md w-full overflow-hidden"
            >
              <div className="p-6 text-center">
                <div className="w-16 h-16 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-full flex items-center justify-center mx-auto mb-4">
                  <AlertTriangle className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">បញ្ជាក់ការលុបក្រុម</h3>
                <p className="text-gray-600 dark:text-gray-400 mb-6">
                  តើអ្នកពិតជាចង់លុបក្រុមនេះមែនទេ? ការលុបក្រុមនឹងមិនលុបមន្ត្រីនៅក្នុងក្រុមនេះទេ ប៉ុន្តែពួកគេនឹងមិនមានក្រុមច្បាស់លាស់។
                </p>
                <div className="flex gap-3">
                  <button 
                    onClick={() => setDeletingGroupId(null)}
                    className="flex-1 px-4 py-2.5 border border-gray-300 dark:border-gray-700 rounded-xl font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-all"
                  >
                    បោះបង់
                  </button>
                  <button 
                    onClick={() => handleDeleteGroup(deletingGroupId)}
                    className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition-all shadow-sm"
                  >
                    លុបចេញ
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Export Preview Modal */}
      <AnimatePresence>
        {isPreviewingExport && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsPreviewingExport(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white dark:bg-gray-900 rounded-3xl shadow-2xl dark:shadow-none border border-gray-200 dark:border-gray-800 w-full max-w-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between bg-white dark:bg-gray-900 sticky top-0 z-20">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center">
                    <FileSpreadsheet className="text-green-600 dark:text-green-400 w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold dark:text-white">កំណត់ការទាញយកទិន្នន័យ (Excel)</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400">ជ្រើសរើសព័ត៌មានដែលអ្នកចង់បង្ហាញក្នុងឯកសារ</p>
                  </div>
                </div>
                <button onClick={() => setIsPreviewingExport(false)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors text-gray-500 dark:text-gray-400">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8">
                {/* Filter Selection */}
                <div>
                  <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                    <Filter className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    ជម្រើសចម្រោះទិន្នន័យ
                  </h4>
                  <label className="flex items-center gap-3 p-4 rounded-xl border border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-all bg-white dark:bg-gray-900">
                    <input 
                      type="checkbox" 
                      checked={exportConfig.onlyWithMissions}
                      onChange={(e) => setExportConfig({
                        ...exportConfig,
                        onlyWithMissions: e.target.checked
                      })}
                      className="w-5 h-5 rounded border-gray-300 dark:border-gray-700 text-blue-600 focus:ring-blue-500 dark:bg-gray-800"
                    />
                    <div>
                      <span className="text-sm font-bold text-gray-900 dark:text-white block">បង្ហាញតែមន្ត្រីដែលមានបេសកកម្ម</span>
                      <span className="text-xs text-gray-500 dark:text-gray-400">ទាញយកតែមន្ត្រីណាដែលមានការចុះបេសកកម្មក្នុងខែនេះប៉ុណ្ណោះ</span>
                    </div>
                  </label>
                </div>

                {/* Column Selection */}
                <div>
                  <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                    <Layout className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    ជ្រើសរើសជួរឈរ (Columns)
                  </h4>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    {Object.entries(exportConfig.columns).map(([key, value]) => (
                      <label key={key} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 dark:border-gray-800 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-all">
                        <input 
                          type="checkbox" 
                          checked={value}
                          onChange={(e) => setExportConfig({
                            ...exportConfig,
                            columns: { ...exportConfig.columns, [key]: e.target.checked }
                          })}
                          className="w-5 h-5 rounded border-gray-300 dark:border-gray-700 text-blue-600 focus:ring-blue-500 dark:bg-gray-800"
                        />
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          {key === 'name' ? 'ឈ្មោះ' : 
                           key === 'position' ? 'តួនាទី' : 
                           key === 'group' ? 'ក្រុម' : 
                           key === 'gender' ? 'ភេទ' : 'ថ្ងៃបេសកកម្ម'}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Group Selection */}
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h4 className="text-sm font-bold text-gray-900 dark:text-white flex items-center gap-2">
                      <Users className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                      ជ្រើសរើសក្រុម/ការិយាល័យ
                    </h4>
                    <div className="flex gap-3">
                      <button 
                        onClick={() => setExportConfig({ ...exportConfig, selectedGroups: uniqueGroups })}
                        className="text-xs text-blue-600 dark:text-blue-400 font-bold hover:underline"
                      >
                        ជ្រើសរើសទាំងអស់
                      </button>
                      <button 
                        onClick={() => setExportConfig({ ...exportConfig, selectedGroups: [] })}
                        className="text-xs text-red-600 dark:text-red-400 font-bold hover:underline"
                      >
                        សម្អាត
                      </button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {uniqueGroups.map(group => {
                      const isSelected = exportConfig.selectedGroups.includes(group);
                      return (
                        <button
                          key={group}
                          onClick={() => {
                            const newGroups = isSelected
                              ? exportConfig.selectedGroups.filter(g => g !== group)
                              : [...exportConfig.selectedGroups, group];
                            setExportConfig({ ...exportConfig, selectedGroups: newGroups });
                          }}
                          className={cn(
                            "px-4 py-2 rounded-full text-xs font-bold border transition-all",
                            isSelected 
                              ? "bg-blue-600 border-blue-600 text-white shadow-md shadow-blue-200 dark:shadow-none" 
                              : "bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-blue-300 dark:hover:border-blue-700"
                          )}
                        >
                          {group}
                        </button>
                      );
                    })}
                    {uniqueGroups.length === 0 && (
                      <p className="text-xs text-gray-400 italic">មិនមានក្រុមសម្រាប់ជ្រើសរើស</p>
                    )}
                  </div>
                </div>

                {/* Summary Preview */}
                <div className="p-6 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-gray-100 dark:border-gray-800">
                  <h4 className="text-sm font-bold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
                    <TableIcon className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                    មើលទិន្នន័យសាកល្បង (Preview)
                  </h4>
                  
                  <div className="overflow-x-auto border border-gray-200 dark:border-gray-800 rounded-xl bg-white dark:bg-gray-900 mb-4">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-800">
                        <tr>
                          {exportConfig.columns.name && <th className="p-2 font-bold text-gray-600 dark:text-gray-400">ឈ្មោះ</th>}
                          {exportConfig.columns.position && <th className="p-2 font-bold text-gray-600 dark:text-gray-400">តួនាទី</th>}
                          {exportConfig.columns.group && <th className="p-2 font-bold text-gray-600 dark:text-gray-400">ក្រុម</th>}
                          {exportConfig.columns.gender && <th className="p-2 font-bold text-gray-600 dark:text-gray-400">ភេទ</th>}
                          {exportConfig.columns.days && <th className="p-2 font-bold text-gray-600 dark:text-gray-400 text-center">ថ្ងៃបេសកកម្ម</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {(() => {
                          const month = getMonth(currentDate) + 1;
                          const year = getYear(currentDate);
                          
                          const previewList = officialsForExportBase
                            .filter(o => exportConfig.selectedGroups.includes(getGroupNameKh(o.group)))
                            .filter(o => {
                              if (!exportConfig.onlyWithMissions) return true;
                              const mission = missions.find(m => m.officialId === o.id && m.month === month && m.year === year);
                              return mission && mission.days.length > 0;
                            });
                          
                          if (previewList.length === 0) {
                            return (
                              <tr>
                                <td colSpan={5} className="p-4 text-center text-gray-400 italic">មិនមានទិន្នន័យត្រូវបង្ហាញ</td>
                              </tr>
                            );
                          }

                          return previewList.slice(0, 5).map(official => {
                            const mission = missions.find(m => m.officialId === official.id && m.month === month && m.year === year);
                            
                            return (
                              <tr key={official.id} className="border-b border-gray-100 dark:border-gray-800 last:border-0">
                                {exportConfig.columns.name && <td className="p-2 text-gray-900 dark:text-gray-100 font-medium">{official.name}</td>}
                                {exportConfig.columns.position && <td className="p-2 text-gray-500 dark:text-gray-400">{official.position}</td>}
                                {exportConfig.columns.group && <td className="p-2 text-gray-500 dark:text-gray-400">{getGroupNameKh(official.group)}</td>}
                                {exportConfig.columns.gender && <td className="p-2 text-gray-500 dark:text-gray-400">{official.gender === 'M' ? 'ប' : 'ស'}</td>}
                                {exportConfig.columns.days && (
                                  <td className="p-2 text-center">
                                    <div className="flex flex-wrap gap-0.5 justify-center">
                                      {mission?.days.map(d => (
                                        <span key={d} className="w-4 h-4 bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 rounded-[2px] flex items-center justify-center text-[8px] font-bold">
                                          {d}
                                        </span>
                                      ))}
                                      {(!mission || mission.days.length === 0) && <span className="text-gray-300 dark:text-gray-600">-</span>}
                                    </div>
                                  </td>
                                )}
                              </tr>
                            );
                          });
                        })()}
                        {(() => {
                          const previewList = officialsForExportBase.filter(o => exportConfig.selectedGroups.includes(getGroupNameKh(o.group)));
                          return previewList.length > 5 && (
                            <tr className="bg-gray-50/50 dark:bg-gray-800/30">
                              <td colSpan={5} className="p-2 text-center text-gray-400 dark:text-gray-500 text-[10px]">
                                ... និងមន្ត្រីចំនួន {previewList.length - 5} នាក់ផ្សេងទៀត
                              </td>
                            </tr>
                          );
                        })()}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-gray-900 dark:text-white">សេចក្តីសង្ខេប</h4>
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                      មន្ត្រីសរុបនឹងត្រូវទាញយក៖ <span className="font-bold text-blue-600 dark:text-blue-400">
                        {(() => {
                          const month = getMonth(currentDate) + 1;
                          const year = getYear(currentDate);
                          return officialsForExportBase
                            .filter(o => exportConfig.selectedGroups.includes(getGroupNameKh(o.group)))
                            .filter(o => {
                              if (!exportConfig.onlyWithMissions) return true;
                              const mission = missions.find(m => m.officialId === o.id && m.month === month && m.year === year);
                              return mission && mission.days.length > 0;
                            }).length;
                        })()} នាក់
                      </span>
                      <span className="mx-2 text-gray-300 dark:text-gray-700">|</span>
                      សម្រាប់ខែ៖ <span className="font-bold text-gray-900 dark:text-white">{kmMonths[getMonth(currentDate)]} {getYear(currentDate)}</span>
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-6 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-800 flex gap-4">
                <button 
                  onClick={() => handlePrint()}
                  className="flex-1 px-6 py-3 border border-gray-300 dark:border-gray-700 rounded-2xl font-bold text-gray-600 dark:text-gray-300 hover:bg-white dark:hover:bg-gray-800 transition-all flex items-center justify-center gap-2"
                >
                  <Printer className="w-5 h-5" />
                  បោះពុម្ព
                </button>
                <button 
                  onClick={() => handleExportToExcel()}
                  className="flex-1 px-6 py-3 bg-green-600 text-white rounded-2xl font-bold hover:bg-green-700 transition-all shadow-lg shadow-green-100 dark:shadow-none flex items-center justify-center gap-2"
                >
                  <Download className="w-5 h-5" />
                  ទាញយកឥឡូវនេះ
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <footer className="mt-20 pb-12 border-t border-gray-100 dark:border-gray-800 pt-12">
        <div className="max-w-7xl mx-auto px-4 flex flex-col md:flex-row items-center justify-between gap-8">
          <div className="text-center md:text-left">
            <p className="text-gray-400 dark:text-gray-500 text-xs mb-2">© {new Date().getFullYear()} នាយកដ្ឋានរដ្ឋបាល។ រក្សាសិទ្ធិគ្រប់យ៉ាង។</p>
            <p className="text-gray-500 dark:text-gray-400 text-sm font-medium">ប្រព័ន្ធគ្រប់គ្រងបេសកកម្មនាយកដ្ឋានរដ្ឋបាល v2.0</p>
          </div>
          
          <div className="flex items-center gap-6 bg-white dark:bg-gray-900 p-4 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800">
            <div className="text-right">
              <p className="text-gray-900 dark:text-white font-bold text-sm mb-1">កម្មវិធីនេះត្រូវបានបង្កើតឡើងដោយលោក ឡុង ពុធដាណូ</p>
              <p className="text-gray-500 dark:text-gray-400 text-xs leading-relaxed">
                សូមស្កេន QR Code សម្រាប់ជំនួយផ្នែកបច្ចេកទេស<br/>ការប្រើប្រាស់កម្មវិធី
              </p>
            </div>
            <div className="w-20 h-20 bg-gray-50 dark:bg-gray-800 rounded-xl overflow-hidden border border-gray-100 dark:border-gray-800 p-1">
              <img 
                src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=https://t.me/PUDANO" 
                alt="Telegram QR Code"
                className="w-full h-full object-contain"
                referrerPolicy="no-referrer"
              />
            </div>
          </div>
        </div>
      </footer>
      {/* Toast Notifications */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 50, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: 50, x: '-50%' }}
            className={`fixed bottom-8 left-1/2 z-[100] px-6 py-3 rounded-2xl shadow-2xl dark:shadow-none flex items-center gap-3 border ${
              toast.type === 'success' 
                ? 'bg-green-600 dark:bg-green-700 text-white border-green-500 dark:border-green-600' 
                : toast.type === 'info'
                ? 'bg-blue-600 dark:bg-blue-700 text-white border-blue-500 dark:border-blue-600'
                : 'bg-red-600 dark:bg-red-700 text-white border-red-500 dark:border-red-600'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5" />
            ) : toast.type === 'info' ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <AlertTriangle className="w-5 h-5" />
            )}
            <span className="font-medium">{toast.message}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

import React from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import DOMPurify from 'dompurify';
