<script setup lang="ts">
import type { NuxtError } from '#app'
defineProps<{ error: NuxtError }>()
</script>
<template>
  <main class="error-page"><span class="mono text-lime">{{ error.statusCode }} / LOST IN EXPLORATION</span><h1>这条路，暂时还没写好。</h1><p>试着回到起点，换一个方向继续探索。</p><button class="button button-lime" @click="clearError({ redirect: '/' })">回到首页 <AppIcon name="arrow" :size="18" /></button></main>
</template>
