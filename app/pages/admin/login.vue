<script setup lang="ts">
definePageMeta({layout: 'admin-auth'})

useHead({title: '管理员登录 · 信息通信技术协会'})

const account = ref('')
const password = ref('')
const remember = ref(true)
const showPassword = ref(false)
const loading = ref(false)
const error = ref('')

const {push} = useToast()

function submit() {
    error.value = ''

    if (!account.value.trim() || !password.value.trim()) {
        error.value = '请填写管理员账号与密码'
        return
    }

    loading.value = true
    // 演示模式：不做任何后端校验，延时后直接进入概览。
    setTimeout(() => {
        loading.value = false
        push({type: 'success', title: '登录成功', description: '演示模式 · 未接入后端'})
        navigateTo('/admin/overview')
    }, 1200)
}
</script>

<template>
  <div class="admin-auth-brand">
    <div class="admin-auth-orbit"/>
    <div class="admin-auth-orbit is-two"/>

    <div class="admin-auth-brand-head">
      <span class="admin-brand-mark">
        <AdminIcon name="layers" :size="19"/>
      </span>
      <span>
        <strong>信息通信技术协会</strong>
        <small>ADMIN CONSOLE</small>
      </span>
    </div>

    <div class="admin-auth-copy">
      <p class="eyebrow">
        <span class="status-dot"/>
        <span class="mono">PRIVATE · STAFF ONLY</span>
      </p>
      <h1>协会内容<br>管理工作台</h1>
      <p>管理公告与动态、审阅访客留言、维护站点信息。所有数据均为演示数据，本次未接入后端。</p>
    </div>

    <div class="admin-auth-terminal">
      <div class="admin-auth-terminal-bar">
        <i/><i/><i/>
        <span>ict-admin@console</span>
      </div>
      <div class="admin-auth-terminal-body">
        <div><span class="dim">$</span> npm run dev</div>
        <div><span class="dim">$</span> nuxt dev --host 127.0.0.1</div>
        <div><span class="ok">✓</span> Vite client warmed up</div>
        <div><span class="ok">✓</span> Listening on <span class="ok">http://127.0.0.1:3000</span></div>
        <div><span class="dim">$</span> <span class="caret"/></div>
      </div>
    </div>
  </div>

  <div class="admin-auth-panel">
    <div class="admin-auth-card">
      <header>
        <p class="eyebrow">
          <span class="section-number">01</span>
          <span class="mono">SIGN IN</span>
        </p>
        <h2>管理员登录</h2>
        <p>请使用协会分配的账号进入管理工作台。</p>
      </header>

      <form novalidate @submit.prevent="submit">
        <div class="admin-field-group">
          <label class="admin-input-label" for="admin-account">管理员账号</label>
          <div class="admin-input-wrap">
            <input id="admin-account" v-model="account" class="admin-input" type="text" autocomplete="username"
                   placeholder="请输入账号">
          </div>
        </div>

        <div class="admin-field-group">
          <label class="admin-input-label" for="admin-password">登录密码</label>
          <div class="admin-input-wrap">
            <input id="admin-password" v-model="password" class="admin-input"
                   :type="showPassword ? 'text' : 'password'" autocomplete="current-password"
                   placeholder="请输入密码">
            <button class="admin-input-action" type="button" :aria-label="showPassword ? '隐藏密码' : '显示密码'"
                    @click="showPassword = !showPassword">
              <AdminIcon :name="showPassword ? 'eye-off' : 'eye'" :size="16"/>
            </button>
          </div>
        </div>

        <p v-if="error" class="admin-error-text">
          <AdminIcon name="alert" :size="13"/>
          {{ error }}
        </p>

        <div class="admin-auth-row">
          <label class="admin-checkline">
            <input v-model="remember" class="admin-check" type="checkbox">
            <span>记住这台设备</span>
          </label>
          <a href="#" class="text-link" style="font-size: 11.5px; gap: 7px" @click.prevent>
            忘记密码？
          </a>
        </div>

        <button class="admin-btn is-primary admin-auth-submit" type="submit" :disabled="loading">
          <span v-if="loading" class="admin-spinner"/>
          <AdminIcon v-else name="logout" :size="15"/>
          {{ loading ? '正在进入…' : '登录工作台' }}
        </button>
      </form>

      <div class="admin-auth-hint">
        <AdminIcon name="info" :size="15"/>
        <span>当前为演示版本：任意账号与密码均可登录，不会发送任何网络请求。接入后端后，此处将替换为真实鉴权请求。</span>
      </div>

      <p class="admin-auth-foot">
        <NuxtLink to="/">
          返回协会站点
          <AdminIcon name="chevron" :size="12"/>
        </NuxtLink>
      </p>
    </div>
  </div>
</template>
