import { Hono } from 'hono'

const app = new Hono()

app.get('/', (hello) => {
  return hello.text('Hello Hono!')
})

export default app
