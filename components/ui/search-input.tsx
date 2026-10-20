import { Search } from "lucide-react";
import { Input } from "./field";

export function SearchInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
      <Input {...props} className={"pl-9 " + (props.className ?? "")} />
    </div>
  );
}
