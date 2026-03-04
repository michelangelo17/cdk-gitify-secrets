import * as readline from 'node:readline'

export const prompt = (question: string, hidden = false): Promise<string> =>
  new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    if (hidden) {
      const stdin = process.stdin
      const onData = (char: Buffer) => {
        const c = char.toString()
        if (c === '\n' || c === '\r') return
        process.stdout.write('*')
      }

      process.stdout.write(question)
      stdin.on('data', onData)

      rl.question('', (answer) => {
        stdin.removeListener('data', onData)
        process.stdout.write('\n')
        rl.close()
        resolve(answer)
      })
    } else {
      rl.question(question, (answer) => {
        rl.close()
        resolve(answer)
      })
    }
  })

export const confirm = async (
  question: string,
  defaultYes = true,
): Promise<boolean> => {
  const suffix = defaultYes ? '(Y/n)' : '(y/N)'
  const answer = await prompt(`${question} ${suffix}: `)
  if (answer.trim() === '') return defaultYes
  return answer.trim().toLowerCase().startsWith('y')
}
