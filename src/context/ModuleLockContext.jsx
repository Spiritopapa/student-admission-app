import { createContext, useContext, useMemo } from 'react';

const ModuleLockContext = createContext({ lockedModules: new Set(), isModuleLocked: () => false });

export function ModuleLockProvider({ lockedModuleNames = [], children }) {
  const value = useMemo(() => {
    const lockedModules = new Set(lockedModuleNames);
    return { lockedModules, isModuleLocked: (moduleName) => lockedModules.has(moduleName) };
  }, [lockedModuleNames]);
  return <ModuleLockContext.Provider value={value}>{children}</ModuleLockContext.Provider>;
}

export function useModuleLock() {
  return useContext(ModuleLockContext);
}
