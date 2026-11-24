<script setup lang="ts">
const {toasts, remove} = useToast()

const toneMap = {
    success: '#c2f970',
    info: '#a6c6e5',
    error: '#e58f80'
} as const

const iconMap = {
    success: 'check',
    info: 'info',
    error: 'alert'
} as const
</script>

<template>
  <div class="admin-toasts" role="status" aria-live="polite">
    <TransitionGroup name="admin-toast">
      <div v-for="toast in toasts" :key="toast.id" class="admin-toast" :style="{'--tone': toneMap[toast.type]}">
        <span class="admin-toast-icon">
          <AdminIcon :name="iconMap[toast.type]" :size="13"/>
        </span>
        <div>
          <strong>{{ toast.title }}</strong>
          <small v-if="toast.description">{{ toast.description }}</small>
        </div>
        <button class="admin-toast-close" type="button" aria-label="关闭提示" @click="remove(toast.id)">
          <AdminIcon name="close" :size="14"/>
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
