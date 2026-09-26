// 外部权威库的图标码 → lucide 组件。
//
// 图标码存在 external databases 注册表里（后台可改），所以这里是"码到组件"的解析表，
// 而不是每个库写死一个样式。实体外链区与导入弹窗共用同一份：同一个库在两个界面
// 显示成两个图标只会让人怀疑自己点错了。
import {
  Globe,
  BookOpen,
  Music,
  Film,
  Tv,
  Gamepad2,
  Database,
  Disc,
  Disc3,
  Apple,
  Sparkles,
  Barcode,
  UserCheck,
  GraduationCap,
  AtSign,
  User,
  Smile,
  Package,
  ShoppingBag,
} from "lucide-react";

const AUTHORITY_ICON_MAP: Record<string, any> = {
  globe: Globe,
  book: BookOpen,
  bookopen: BookOpen,
  bookheart: BookOpen,
  music: Music,
  music2: Music,
  film: Film,
  clapperboard: Film,
  tv: Tv,
  tv2: Tv,
  gamepad: Gamepad2,
  gamepad2: Gamepad2,
  database: Database,
  disc: Disc,
  disc3: Disc3,
  apple: Apple,
  sparkles: Sparkles,
  barcode: Barcode,
  usercheck: UserCheck,
  graduationcap: GraduationCap,
  atsign: AtSign,
  user: User,
  smile: Smile,
  package: Package,
  shoppingbag: ShoppingBag,
};

// authorityIcon 解析注册表的 icon 码；未知码回落到 Globe，
// 不渲染空白（后台可以填任意字符串，界面不该因此缺一块）。
export function authorityIcon(code?: string | null): any {
  if (!code) return Globe;
  return AUTHORITY_ICON_MAP[code.toLowerCase()] || Globe;
}
