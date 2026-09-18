import {
  AlignCenter as AlignCenterIcon,
  AlignLeft as AlignLeftIcon,
  AlignRight as AlignRightIcon,
  ArrowLeftRight as ArrowLeftRightIcon,
  Camera as CameraIcon,
  Check as CheckIcon,
  ChevronDown as ChevronDownIcon,
  ChevronRight as ChevronRightIcon,
  ClipboardList as ClipboardListIcon,
  Clock as ClockIcon,
  Columns2,
  Eye as EyeIcon,
  FileImage,
  Film as FilmIcon,
  FlipHorizontal as FlipHorizontalIcon,
  FlipVertical as FlipVerticalIcon,
  Grip,
  IndentIncrease,
  Layers as LayersIcon,
  Link as LinkIcon,
  List,
  ListOrdered,
  Minus as MinusIcon,
  Move as MoveIcon,
  Music as MusicIcon,
  Palette as PaletteIcon,
  Pipette,
  Plus as PlusIcon,
  RotateCcw as RotateCcwIcon,
  RotateCw as RotateCwIcon,
  Scissors as ScissorsIcon,
  Settings as SettingsIcon,
  Square as SquareIcon,
  SquareDashed,
  Trash2,
  Type as TypeIcon,
  X as XIcon,
  Zap as ZapIcon,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

type IconProps = LucideProps & { title?: string };

function makeIcon(Icon: LucideIcon) {
  return function SystemIcon({ title, ...props }: IconProps) {
    return <Icon aria-label={title} aria-hidden={title ? undefined : true} {...props} />;
  };
}

export const Check = makeIcon(CheckIcon);
export const Clock = makeIcon(ClockIcon);
export const Eye = makeIcon(EyeIcon);
export const Film = makeIcon(FilmIcon);
export const Layers = makeIcon(LayersIcon);
export const Move = makeIcon(MoveIcon);
export const Music = makeIcon(MusicIcon);
export const Palette = makeIcon(PaletteIcon);
export const Minus = makeIcon(MinusIcon);
export const Plus = makeIcon(PlusIcon);
export const Square = makeIcon(SquareIcon);
export const Compare = makeIcon(Columns2);
export const Type = makeIcon(TypeIcon);
export const X = makeIcon(XIcon);
export const Zap = makeIcon(ZapIcon);
export const ChevronDown = makeIcon(ChevronDownIcon);
export const ChevronRight = makeIcon(ChevronRightIcon);
export const ClipboardList = makeIcon(ClipboardListIcon);
export const RotateCcw = makeIcon(RotateCcwIcon);
export const Camera = makeIcon(CameraIcon);
export const RotateCw = makeIcon(RotateCwIcon);
export const Settings = makeIcon(SettingsIcon);
export const Scissors = makeIcon(ScissorsIcon);
export const Link = makeIcon(LinkIcon);
export const FlipHorizontal = makeIcon(FlipHorizontalIcon);
export const FlipVertical = makeIcon(FlipVerticalIcon);
export const DotsNine = makeIcon(Grip);
export const ImageSquare = makeIcon(FileImage);
export const Eyedropper = makeIcon(Pipette);
export const ExcludeSquare = makeIcon(SquareDashed);
export const Trash = makeIcon(Trash2);
export const ArrowLeftRight = makeIcon(ArrowLeftRightIcon);
export const AlignLeft = makeIcon(AlignLeftIcon);
export const AlignCenter = makeIcon(AlignCenterIcon);
export const AlignRight = makeIcon(AlignRightIcon);
export const ListBullets = makeIcon(List);
export const ListNumbers = makeIcon(ListOrdered);
export const TextIndent = makeIcon(IndentIncrease);
