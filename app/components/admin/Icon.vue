<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number | string }>(), {size: 18})
const paths: Record<string, string> = {
  dashboard: 'M4 4h6v7H4zM14 4h6v4h-6zM14 12h6v8h-6zM4 15h6v5H4z',
  file: 'M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7zm0 0v4h4M9 13h6M9 17h4',
  mail: 'M3 5h18v14H3zM3 5l9 7 9-7',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8.4-3a8.4 8.4 0 0 0-.13-1.4l2-1.5-2-3.4-2.3.9a8.4 8.4 0 0 0-2.4-1.4L15.2 2H8.8l-.37 2.4a8.4 8.4 0 0 0-2.4 1.4l-2.3-.9-2 3.4 2 1.5a8.5 8.5 0 0 0 0 2.8l-2 1.5 2 3.4 2.3-.9a8.4 8.4 0 0 0 2.4 1.4L8.8 22h6.4l.37-2.4a8.4 8.4 0 0 0 2.4-1.4l2.3.9 2-3.4-2-1.5c.08-.46.13-.92.13-1.4Z',
  bell: 'M18 8a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7M10.3 20a2 2 0 0 0 3.4 0',
  search: 'm21 21-4.5-4.5M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0',
  menu: 'M4 7h16M4 12h16M4 17h16',
  close: 'm6 6 12 12M6 18 18 6',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4m7 14 5-5-5-5m5 5H9',
  external: 'M14 3h7v7m0-7L10 14M10 3H3v18h18v-7',
  plus: 'M12 5v14M5 12h14',
  edit: 'M11 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-6M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z',
  trash: 'M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2m3 0-1 13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1L6 7m4 4v7m4-7v7',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  'eye-off': 'M10.6 6.2A9.9 9.9 0 0 1 12 6c6.4 0 10 7 10 7a17.6 17.6 0 0 1-2.4 3.3M6.6 6.6A17.6 17.6 0 0 0 2 13s3.6 7 10 7a9.8 9.8 0 0 0 4.5-1.1M2 2l20 20M9.9 9.9a3 3 0 0 0 4.2 4.2',
  trend: 'M3 17 9 11l4 4 8-8M15 7h6v6',
  calendar: 'M8 3v4m8-4v4M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
  download: 'M12 3v12m-5-5 5 5 5-5M4 19h16',
  refresh: 'M20 11A8 8 0 0 0 6.3 6.3L4 8.5M4 4v4.5h4.5M4 13a8 8 0 0 0 13.7 4.7L20 15.5M20 20v-4.5h-4.5',
  check: 'm5 12 4 4L19 6',
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8-7.87a4 4 0 0 1 0 7.75',
  shield: 'M12 3 5 6v6c0 4.4 3 8.4 7 9 4-.6 7-4.6 7-9V6z',
  alert: 'M12 4 2.5 20h19zM12 10v4m0 3h.01',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5l3 2',
  inbox: 'M4 13h4l1.5 3h5L16 13h4M4 13 6.5 5h11L20 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z',
  filter: 'M3 5h18l-7 8v6l-4 2v-8z',
  chevron: 'm9 6 6 6-6 6',
  'chevron-left': 'm15 6-6 6 6 6',
  'arrow-up': 'M12 19V5m-6 6 6-6 6 6',
  'arrow-down': 'M12 5v14m6-6-6 6-6-6',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-9v5m0-8h.01',
  'more': 'M6 12h.01M12 12h.01M18 12h.01',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z',
  link: 'M10 13a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1m-1 8a5 5 0 0 1-7 0 5 5 0 0 1 0-7l2-2a5 5 0 0 1 7 0',
  comment: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  chart: 'M4 20V10m5 10V4m5 16v-7m5 7V8',
  layers: 'm12 2 9 5-9 5-9-5 9-5Zm-9 5v10l9 5 9-5V7M12 12v10',
  book: 'M12 5v16M12 5C9 2 5 2 2 3v16c3-1 7-1 10 2 3-3 7-3 10-2V3c-3-1-7-1-10 2Z'
}
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
       stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path :d="paths[name] || paths.info"/>
  </svg>
</template>
