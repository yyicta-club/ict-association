<script setup lang="ts">
withDefaults(defineProps<{ name: string; size?: number | string }>(), { size: 20 })
const paths: Record<string, string> = {
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  diagonal: 'M6 18 18 6M6 6h12v12',
  down: 'M12 4v16m-6-6 6 6 6-6',
  search: 'm21 21-4.5-4.5M19 10.5a8.5 8.5 0 1 1-17 0 8.5 8.5 0 0 1 17 0',
  close: 'm6 6 12 12M6 18 18 6',
  menu: 'M4 7h16M4 12h16M4 17h16',
  code: 'm8 5-7 7 7 7m8-14 7 7-7 7M14 3l-4 18',
  cpu: 'M7 7h10v10H7zM4 4h16v16H4zM9 1v3m6-3v3M9 20v3m6-3v3M1 9h3m-3 6h3m16-6h3m-3 6h3',
  trophy: 'M8 3h8v6a4 4 0 0 1-8 0V3Zm0 2H4v2a4 4 0 0 0 4 4m8-6h4v2a4 4 0 0 1-4 4m-4 2v6m-4 2h8M9 19h6',
  blocks: 'm12 2 9 5-9 5-9-5 9-5Zm-9 5v10l9 5 9-5V7M12 12v10M7.5 4.5l9 5M7.5 9.5v10',
  spark: 'm12 2 2.8 7.2L22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-2.8L12 2Z',
  check: 'm5 12 4 4L19 6',
  plus: 'M12 5v14M5 12h14',
  copy: 'M9 9h12v12H9zM15 5V3H3v12h2',
  external: 'M14 3h7v7m0-7L10 14M10 3H3v18h18v-7',
  mail: 'M3 5h18v14H3zM3 5l9 7 9-7',
  pause: 'M8 5v14M16 5v14',
  play: 'm8 4 12 8-12 8V4Z',
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z',
  terminal: 'm4 6 6 6-6 6m8 0h8',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8-7.87a4 4 0 0 1 0 7.75',
  book: 'M12 5v16M12 5C9 2 5 2 2 3v16c3-1 7-1 10 2 3-3 7-3 10-2V3c-3-1-7-1-10 2Z'
}
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name] || paths.arrow" /></svg>
</template>
