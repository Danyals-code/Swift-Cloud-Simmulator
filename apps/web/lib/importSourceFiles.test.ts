import { expect, it } from 'vitest'
import { readSwiftFiles } from './importSourceFiles'

it('preserves UTF-8 BOM, Unicode, CRLF, comments, and trailing source bytes', async () => {
  const source = '\uFEFFimport SwiftUI\r\n// 日本語\r\nText("Hello")  \r\n'
  const bytes = new TextEncoder().encode(source)
  const files = await readSwiftFiles([new File([bytes], 'App.swift')])
  expect(new TextEncoder().encode(files[0]!.text)).toEqual(bytes)
})
it('rejects an invalid UTF-8 member without opening the valid files beside it', async () => {
  await expect(readSwiftFiles([new File(['Text("Good")'], 'Good.swift'), new File([new Uint8Array([0xff, 0xff])], 'Bad.swift')])).rejects.toThrow(/UTF-8/)
})
it('rejects oversized selections, unsafe paths, and case/Unicode collisions before reading', async () => {
  await expect(readSwiftFiles([new File([new Uint8Array(8 * 1024 * 1024 + 1)], 'Large.swift')])).rejects.toThrow(/8 MB/)
  await expect(readSwiftFiles([new File(['a'], '../App.swift')])).rejects.toThrow(/invalid/)
  await expect(readSwiftFiles([new File(['a'], 'App.swift'), new File(['b'], 'app.swift')])).rejects.toThrow(/colliding/)
  await expect(readSwiftFiles([new File(['a'], 'é.swift'), new File(['b'], 'e\u0301.swift')])).rejects.toThrow(/colliding/)
})
