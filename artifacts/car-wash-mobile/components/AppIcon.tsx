import React from 'react';
import {
  AlertCircle, AlertTriangle, ArrowLeft, ArrowRight, Award, Banknote, Bell, Briefcase,
  Calendar, Car, Check, CheckCircle, ChevronRight, Circle, Clock, CreditCard, Droplet, Droplets, Pencil,
  FileText, Home, Info, Loader, LogIn, LogOut, Mail, MapPin, MapPinOff, MessageCircle, Minus, Navigation,
  Phone, Plus, PlusCircle, RefreshCw, Search, Send, Shield, Smartphone, Star,
  Tag, Terminal, Truck, User, UserCheck, X, XCircle, Zap,
} from 'lucide-react-native';

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  'alert-circle': AlertCircle,
  'alert-triangle': AlertTriangle,
  'arrow-left': ArrowLeft,
  'arrow-right': ArrowRight,
  'award': Award,
  'banknote': Banknote,
  'bell': Bell,
  'briefcase': Briefcase,
  'calendar': Calendar,
  'car': Car,
  'check': Check,
  'check-circle': CheckCircle,
  'chevron-right': ChevronRight,
  'circle': Circle,
  'clock': Clock,
  'credit-card': CreditCard,
  'droplet': Droplet,
  'droplets': Droplets,
  'edit-2': Pencil,
  'file-text': FileText,
  'home': Home,
  'info': Info,
  'loader': Loader,
  'log-in': LogIn,
  'log-out': LogOut,
  'mail': Mail,
  'map-pin': MapPin,
  'map-pin-off': MapPinOff,
  'message-circle': MessageCircle,
  'minus': Minus,
  'navigation': Navigation,
  'phone': Phone,
  'plus': Plus,
  'plus-circle': PlusCircle,
  'refresh-cw': RefreshCw,
  'search': Search,
  'send': Send,
  'shield': Shield,
  'smartphone': Smartphone,
  'star': Star,
  'tag': Tag,
  'terminal': Terminal,
  'truck': Truck,
  'user': User,
  'user-check': UserCheck,
  'x': X,
  'x-circle': XCircle,
  'zap': Zap,
};

interface AppIconProps {
  name: string;
  size?: number;
  color?: string;
  strokeWidth?: number;
  style?: any;
}

export default function AppIcon({ name, size = 24, color = '#000', strokeWidth = 2, style }: AppIconProps) {
  const IconComponent = ICON_MAP[name];
  if (!IconComponent) {
    console.warn(`AppIcon: unknown icon "${name}"`);
    return null;
  }
  return <IconComponent size={size} color={color} strokeWidth={strokeWidth} style={style} />;
}
