export function managementSerialSafetyPlugin() {
  return {
    name: 'management-serial-safety',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('src/App.jsx')) return null
      let out = code

      // Do not explicitly toggle DTR/RTS after opening the CH340 port.
      // On UNO-class boards that extra control-line transition can cause another reset.
      out = out.replace(
        `      try {\n        await port.setSignals({ dataTerminalReady: false, requestToSend: false })\n      } catch {}\n\n`,
        ''
      )

      // If opening/initializing the port fails after requestPort(), release anything that may have opened.
      const oldCatch = `    } catch (error) {\n      setMasterStatus('연결 실패')\n      if (error?.name !== 'NotFoundError') showToast(error?.message || 'MASTER 연결에 실패했어요.')\n    }`
      const newCatch = `    } catch (error) {\n      const opened = serialPortRef.current\n      serialPortRef.current = null\n      masterReadyRef.current = false\n      setMasterConnected(false)\n      setMasterProtocolReady(false)\n      try { await serialReaderRef.current?.cancel() } catch {}\n      serialReaderRef.current = null\n      try { serialWriterRef.current?.releaseLock() } catch {}\n      serialWriterRef.current = null\n      try { await opened?.close() } catch {}\n      setMasterStatus('연결 실패')\n      if (error?.name !== 'NotFoundError') showToast(error?.message || 'MASTER 연결에 실패했어요. Arduino Serial Monitor가 열려 있으면 닫아 주세요.')\n    }`
      if (out.includes(oldCatch)) out = out.replace(oldCatch, newCatch)

      return { code: out, map: null }
    },
  }
}
