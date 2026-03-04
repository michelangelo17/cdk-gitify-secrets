import * as readline from 'node:readline'

const hiddenPrompt = (question: string): Promise<string> =>
  new Promise((resolve) => {
    process.stdout.write(question)

    const stdin = process.stdin
    const wasRaw = stdin.isRaw
    if (stdin.isTTY) stdin.setRawMode(true)
    stdin.resume()

    let input = ''
    const onData = (buf: Buffer) => {
      const c = buf.toString()

      if (c === '\n' || c === '\r' || c === '\u0004') {
        stdin.removeListener('data', onData)
        if (stdin.isTTY) stdin.setRawMode(wasRaw)
        stdin.pause()
        process.stdout.write('\n')
        resolve(input)
      } else if (c === '\u0003') {
        process.stdout.write('\n')
        process.exit(130)
      } else if (c === '\u007f' || c === '\b') {
        if (input.length > 0) {
          input = input.slice(0, -1)
          process.stdout.write('\b \b')
        }
      } else {
        input += c
        process.stdout.write('*')
      }
    }

    stdin.on('data', onData)
  })

export const prompt = (question: string, hidden = false): Promise<string> => {
  if (hidden) return hiddenPrompt(question)

  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    rl.question(question, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

export const confirm = async (
  question: string,
  defaultYes = true,
): Promise<boolean> => {
  const suffix = defaultYes ? '(Y/n)' : '(y/N)'
  const answer = await prompt(`${question} ${suffix}: `)
  if (answer.trim() === '') return defaultYes
  return answer.trim().toLowerCase().startsWith('y')
}
