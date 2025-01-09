import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export const getApiUrl = () => {
  if (import.meta.env.PROD) {
    return '/api'
  }
  return 'http://localhost:8000'
}
