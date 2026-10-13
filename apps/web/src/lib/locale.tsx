"use client";

import { useEffect, useSyncExternalStore, type ReactNode } from "react";

export const messages = {
  en: {
    common: {
      language: "Čeština",
      switchLanguage: "Switch language to Czech",
      back: "← Back to Papyr",
      retry: "Retry",
      theme: "Theme",
      themeDescription: "Choose how Papyr looks on this device.",
      light: "Light",
      dark: "Dark",
      system: "System",
    },
    auth: {
      title: "Server account",
      username: "Username",
      password: "Password",
      setupToken: "One-time setup token",
      login: "Sign in",
      setup: "Initialize owner",
      showSetup: "First-time setup",
      logout: "Sign out",
      checking: "Checking session…",
      loggedIn: (name: string) => `Signed in as ${name}`,
      loggedOut: "Not signed in · local notes remain available",
      unavailable: "Server unavailable · local notes remain available",
      setupCheckFailed: "Setup status check failed",
      setupConnectionError: "Papyr could not reach the API. Check the deployment and try again.",
      setupDiagnostic: (status: number, code?: string, diagnosticId?: string) =>
        `HTTP ${status}${code ? ` · ${code}` : ""}${diagnosticId ? ` · reference ${diagnosticId}` : ""}`,
      setupDatabaseSchemaError: "The database schema is incomplete. Check that API migrations completed.",
      setupDatabaseAuthError:
        "PostgreSQL rejected the API credentials. Check the API and database passwords in Portainer.",
      setupDatabaseMissing: "The Papyr database was not found. Check the database name in the API settings.",
      setupDatabaseUnavailable:
        "The API could not connect to PostgreSQL. Check that the database container is healthy.",
      setupCheckGenericError:
        "The API could not check setup status. Check the API container and database configuration.",
      retrySetupCheck: "Retry setup check",
      submit: "Working…",
      setupHelp:
        "The setup token is provided by the instance operator. First setup permanently resets server data and this app's local data, then creates the first administrator.",
      confirmReset: "I understand this permanently resets the database and local app data.",
      createAccount: "Create account",
      accountCreated: "Account created. Share its username and password securely.",
    },
    library: {
      heading: "Your library",
      intro: "Create and edit Markdown notes offline. Changes are saved on this device and queued for sync.",
      synced: "Synced to server",
      savedLocal: "Saved on this device",
      pendingSync: "Saved locally · pending sync",
      syncing: "Syncing local changes…",
      offline: "Offline · local changes stay saved",
      syncError: "Sync needs attention",
      authRequired: "Sign in to sync",
      conflictStatus: "A conflict needs attention",
      loading: "Loading your library…",
      loadingError: "Couldn’t read the local library",
      saveError: "Couldn’t save locally. Your title is still here; try again.",
      search: "Search title and note text",
      sortBy: "Sort by",
      lastModified: "Last modified",
      dateCreated: "Date created",
      name: "Name",
      searchResults: "Search results",
      searchScope: "Local notes · titles and content",
      clearSearch: "Clear search",
      navigateResults: "to navigate",
      openResult: "to open",
      openNavigation: "Open navigation",
      closeNavigation: "Close navigation",
      collapseSidebar: "Collapse sidebar",
      expandSidebar: "Expand sidebar",
      breadcrumb: "Location",
      navigation: "Library navigation",
      library: "Library",
      shortcuts: "Shortcuts",
      recent: "Recent",
      settings: "Settings",
      settingsDescription: "Account and device preferences",
      account: "Account",
      serverSync: "Server and sync",
      serverSyncDescription:
        "Sync runs in the background. Your local changes stay on this device until the server acknowledges them.",
      syncStatus: "Sync status",
      new: "New",
      untitled: "Untitled",
      untitledTypst: "Untitled Typst document",
      untitledWhiteboard: "Untitled whiteboard",
      folder: "Folder",
      folderName: "Folder name",
      newSubfolder: "New subfolder",
      newNoteHere: "New Markdown note here",
      newTypstHere: "New Typst document here",
      newWhiteboardHere: "New whiteboard here",
      actions: "More actions",
      expand: "Expand folder",
      collapse: "Collapse folder",
      renameError: "Couldn’t rename this item. The name must not be empty.",
      items: "Folder contents",
      folderDescription: "Notes and folders in this location.",
      trashDescription: "Restore deleted items or permanently remove them from this library and server.",
      emptyTitle: "A clear space to start",
      emptyHelp: "Create a note to capture an idea, or add a folder to organize your library.",
      trashEmpty: "Trash is empty",
      trashEmptyHelp: "Items you move to Trash will appear here for restoration.",
      emptyTrash: "Empty trash",
      confirmEmptyTrash: (count: number) => `Permanently delete all ${count} items in Trash? This cannot be undone.`,
      trashClearNeedsSync: "Sync trashed items and resolve their conflicts before emptying Trash.",
      trashClearError: "Trash could not be emptied. Your items and pending changes remain saved.",
      trashCleared: "Trash emptied here; permanent deletion is queued to sync.",
      noMatchesHelp: "Try a different title or phrase.",
      close: "Close",
      cancel: "Cancel",
      confirmMove: "Move item",
      moveTo: "Move to folder",
      noMatches: "No matching notes.",
      label: "New item",
      placeholder: "Title",
      root: "Library root",
      createNote: "Create Markdown note",
      createTypstNote: "Create Typst note",
      createWhiteboardNote: "Create whiteboard",
      exportSource: "Export source",
      exportPdf: "Export PDF",
      edit: "Edit",
      split: "Split",
      preview: "Preview",
      markdownType: "Markdown",
      typstType: "Typst",
      whiteboardType: "Whiteboard",
      bold: "Bold",
      italic: "Italic",
      headingAction: "Heading",
      link: "Link",
      list: "List",
      codeBlock: "Code block",
      markdownTools: "Markdown tools",
      content: "Content",
      markdownView: "Editor view",
      noteLoading: "Loading note…",
      noteNotFound: "Note not found on this device.",
      savingLocal: "Saving on this device…",
      markdownDescription: "A text note with a live preview",
      typstDescription: "Math, layout, and PDF export",
      whiteboardDescription: "An editable infinite canvas",
      createFolder: "Create folder",
      tree: "Folders and notes",
      empty: "No notes yet.",
      trash: "Trash",
      rename: "Rename",
      move: "Move",
      remove: "Trash",
      restore: "Restore",
      newName: "New name",
      destination: "Destination folder UUID, or leave blank for the library root",
      confirmDelete: (title: string) => `Move “${title}” to trash?`,
      conflicts: "Conflicts",
      localServerChanged: "Local and server versions both have changes.",
      conflictCount: (count: number) => `${count} sync conflict${count === 1 ? "" : "s"}`,
      conflictCountShort: (count: number) => String(count),
      conflictBanner: "Review the changes before choosing which version to keep.",
      reviewConflicts: "Review conflicts",
      conflictCenter: "Conflict center",
      conflictReviewHelp: "Compare the local draft with the current server version before resolving it.",
      reviewConflict: "Review conflict",
      localVersion: "Local version",
      serverVersion: "Server version",
      keepServerHelp: "Use the server version here. Preserve your local note as a recovery copy on this device.",
      keepServerFolderHelp: "Use the server name and location for this folder. Its notes and subfolders stay attached.",
      keepBoth: "Keep both versions",
      keepBothHelp: "Keep the server document and save your local version as a new document.",
      keepLocal: "Keep local version",
      keepLocalHelp: "Replace the server document with this local version. The server revision is checked again.",
      purgeConflictAction: "Permanently delete",
      purgeConflictHelp: "Permanently remove this item from the server too.",
      restorePurgedAction: "Restore local version",
      restorePurgedHelp: "Create the local version on the server again.",
      confirmPurgeConflict: "Permanently delete the server version too? This cannot be undone.",
      confirmRestorePurged: "Restore the local version to the server?",
      acceptServerPurge: "Accept server deletion",
      acceptPurgedNoteHelp: "Remove this note here too. Keep a local recovery copy.",
      acceptPurgedFolderHelp:
        "Remove this folder here too. Its locally pending descendants remain available to review.",
      confirmAcceptPurge: "Accept the server deletion? The local note will remain as a recovery copy when possible.",
      confirmKeepServer: "Use the server version here? Your local note will be preserved as a separate copy.",
      confirmKeepServerFolder:
        "Use the server folder name and location? Local folder changes will be discarded, while its notes and subfolders stay attached.",
      conflictNoPreview:
        "Whiteboard snapshots cannot be previewed here. Keeping both preserves the local snapshot as a separate whiteboard.",
      conflictFolderUnsupported:
        "Folder contents are not shown here. Compare the folder name and location above before resolving.",
      dismissConflictBanner: "Dismiss conflict notice",
      localCopySuffix: " (local copy)",
      conflictError: "Couldn’t resolve this conflict. Both versions remain available.",
      conflictResolved: "Conflict resolution saved on this device",
      conflictFolder: "Folder location",
      conflictModified: "Modified",
      conflictRevisions: "Revisions",
      conflictDiff: "Source differences",
      conflictDiffLarge: "This document is over 500 lines. Compare the complete sources side by side below.",
      lineAdded: "Added",
      lineRemoved: "Removed",
      keepServer: "Use server version",
      localCopy: "Save local as copy",
      overwriteServer: "Overwrite server…",
      confirmOverwrite: "Overwrite the server version with this local version?",
      confirmCopy: "Save the local version as a separate note?",
      syncNow: "Sync now",
      noteType: "Note type",
      attachImage: "Add image",
      writerAcquiring: "Checking whether this tab can edit…",
      writerLocked: "This note is being edited in another tab. This tab is read-only.",
      writerUnsupported: "This browser cannot safely lock this note for editing. This tab is read-only.",
      retryWriter: "Try editing",
    },
    home: {
      phase: "Local notebook",
      heading: "Your words stay on this device.",
      intro: "Your library is saved on this device. Sign in to synchronize changes with your server.",
      draft: "Sample draft",
      status: {
        loading: "Loading this device…",
        loaded: "Loaded from this device",
        saving: "Saving on this device…",
        saved: "Saved on this device",
        readError: "Couldn’t read local storage",
        saveError: "Couldn’t save on this device",
        selectRecovery: "Select draft text to copy",
        noteSaved: "Saved locally · pending sync",
        titleRequired: "Enter a title for the note.",
        createError: "Couldn’t create the local note",
      },
      newNote: "New Markdown note",
      create: "Create note",
      notes: "Local notes",
      savedLocally: "saved locally · pending sync",
      prototypes: "Editor proofs",
      typst: "Typst compiler proof",
      whiteboard: "Whiteboard proof",
    },
    typst: {
      title: "Typst browser proof",
      exportPdf: "Export PDF",
      intro:
        "Compiles locally in a Web Worker with bundled WebAssembly and fonts. Visit once while online, then disconnect and compile again to verify offline behavior.",
      compile: "Compile PDF",
      starting: "Loading bundled Typst compiler…",
      compiled: "Compiled PDF",
      failed: "Compile failed",
      source: "Typst source",
      preview: "Preview",
      switchView: "Typst editor and preview",
      pdfOutput: "PDF output",
      zoomIn: "Zoom in",
      zoomOut: "Zoom out",
      resetZoom: "Reset zoom to fit width",
      emptyPreview: "PDF preview appears here",
      stalePreview: "Showing the last successful PDF · source has errors",
      notStarted: "Compiler not started",
    },
    whiteboard: {
      title: "Whiteboard SDK proof",
      intro:
        "Development editor. Imported image assets are stored locally; Papyr separately saves the editable document snapshot in IndexedDB.",
      save: "Save editable snapshot",
      exportSnapshot: "Download editable snapshot",
      exportPng: "Export PNG",
      exportSvg: "Export SVG",
      export: "Export",
      fit: "Fit canvas to screen",
      exportError: "Couldn’t export this whiteboard",
      loading: "Loading saved snapshot…",
      loadError: "Couldn’t load the saved snapshot",
      ready: "Ready · changes save automatically on this device",
      saving: "Saving snapshot…",
      saved: "Saved locally",
      enterFullscreen: "Enter fullscreen",
      exitFullscreen: "Exit fullscreen",
      saveError: "Couldn’t save snapshot",
      unavailable: "Whiteboard unavailable",
      license: "Production is blocked until an applicable tldraw license key is configured.",
    },
  },
  cs: {
    common: {
      language: "English",
      switchLanguage: "Přepnout jazyk na angličtinu",
      back: "← Zpět do Papyr",
      retry: "Zkusit znovu",
      theme: "Vzhled",
      themeDescription: "Vyberte vzhled Papyr na tomto zařízení.",
      light: "Světlý",
      dark: "Tmavý",
      system: "Systém",
    },
    auth: {
      title: "Účet na serveru",
      username: "Uživatelské jméno",
      password: "Heslo",
      setupToken: "Jednorázový instalační token",
      login: "Přihlásit se",
      setup: "Založit vlastníka",
      showSetup: "První nastavení",
      logout: "Odhlásit se",
      checking: "Ověřuji relaci…",
      loggedIn: (name: string) => `Přihlášen/a jako ${name}`,
      loggedOut: "Nejste přihlášeni · místní poznámky zůstávají dostupné",
      unavailable: "Server není dostupný · místní poznámky zůstávají dostupné",
      setupCheckFailed: "Kontrola stavu prvního nastavení selhala",
      setupConnectionError: "Papyr se nemůže spojit s API. Zkontrolujte nasazení a zkuste to znovu.",
      setupDiagnostic: (status: number, code?: string, diagnosticId?: string) =>
        `HTTP ${status}${code ? ` · ${code}` : ""}${diagnosticId ? ` · reference ${diagnosticId}` : ""}`,
      setupDatabaseSchemaError: "Schéma databáze není úplné. Ověřte, že se dokončily migrace API.",
      setupDatabaseAuthError:
        "PostgreSQL odmítl přihlašovací údaje API. Zkontrolujte hesla API a databáze v Portaineru.",
      setupDatabaseMissing: "Databáze Papyr nebyla nalezena. Zkontrolujte název databáze v nastavení API.",
      setupDatabaseUnavailable: "API se nemůže připojit k PostgreSQL. Zkontrolujte, zda je kontejner databáze zdravý.",
      setupCheckGenericError: "API nemůže ověřit stav nastavení. Zkontrolujte API kontejner a konfiguraci databáze.",
      retrySetupCheck: "Zopakovat kontrolu",
      submit: "Pracuji…",
      setupHelp:
        "Instalační token poskytuje správce instance. První nastavení trvale smaže data serveru i místní data aplikace a vytvoří prvního správce.",
      confirmReset: "Rozumím, že se tím trvale smažou data databáze a místní aplikace.",
      createAccount: "Vytvořit účet",
      accountCreated: "Účet byl vytvořen. Předejte jeho jméno a heslo bezpečným způsobem.",
    },
    library: {
      heading: "Vaše knihovna",
      intro:
        "Vytvářejte a upravujte poznámky Markdown offline. Změny se ukládají do tohoto zařízení a čekají na synchronizaci.",
      synced: "Synchronizováno se serverem",
      savedLocal: "Uloženo v tomto zařízení",
      pendingSync: "Uloženo místně · čeká na synchronizaci",
      syncing: "Synchronizuji místní změny…",
      offline: "Offline · místní změny zůstávají uložené",
      syncError: "Synchronizace vyžaduje pozornost",
      authRequired: "Pro synchronizaci se přihlaste",
      conflictStatus: "Konflikt vyžaduje pozornost",
      loading: "Načítání knihovny…",
      loadingError: "Místní knihovnu se nepodařilo načíst",
      saveError: "Místně se nepodařilo uložit. Název zůstal zachován; zkuste to znovu.",
      search: "Hledat v názvech a textu poznámek",
      sortBy: "Řadit podle",
      lastModified: "Naposledy upraveno",
      dateCreated: "Datum vytvoření",
      name: "Název",
      searchResults: "Výsledky hledání",
      searchScope: "Místní poznámky · názvy a obsah",
      clearSearch: "Zrušit hledání",
      navigateResults: "pro pohyb",
      openResult: "otevřít",
      openNavigation: "Otevřít navigaci",
      closeNavigation: "Zavřít navigaci",
      collapseSidebar: "Sbalit postranní panel",
      expandSidebar: "Rozbalit postranní panel",
      breadcrumb: "Umístění",
      navigation: "Navigace knihovny",
      library: "Knihovna",
      shortcuts: "Zkratky",
      recent: "Nedávné",
      settings: "Nastavení",
      settingsDescription: "Účet a předvolby zařízení",
      account: "Účet",
      serverSync: "Server a synchronizace",
      serverSyncDescription:
        "Synchronizace probíhá na pozadí. Místní změny zůstanou v tomto zařízení, dokud je server nepotvrdí.",
      syncStatus: "Stav synchronizace",
      new: "Nový",
      untitled: "Bez názvu",
      untitledTypst: "Dokument Typst bez názvu",
      untitledWhiteboard: "Tabule bez názvu",
      folder: "Složka",
      folderName: "Název složky",
      newSubfolder: "Nová podsložka",
      newNoteHere: "Nová poznámka Markdown zde",
      newTypstHere: "Nový dokument Typst zde",
      newWhiteboardHere: "Nová tabule zde",
      actions: "Další akce",
      expand: "Rozbalit složku",
      collapse: "Sbalit složku",
      renameError: "Položku se nepodařilo přejmenovat. Název nesmí být prázdný.",
      items: "Obsah složky",
      folderDescription: "Poznámky a složky na tomto místě.",
      trashDescription: "Obnovte smazané položky nebo je trvale odstraňte z této knihovny i serveru.",
      emptyTitle: "Místo pro první poznámku",
      emptyHelp: "Založte poznámku nebo přidejte složku a uspořádejte svou knihovnu.",
      trashEmpty: "Koš je prázdný",
      trashEmptyHelp: "Položky přesunuté do koše se zobrazí zde a můžete je obnovit.",
      emptyTrash: "Vysypat koš",
      confirmEmptyTrash: (count: number) =>
        `Opravdu trvale smazat všech ${count} položek v koši? Tuto akci nelze vrátit.`,
      trashClearNeedsSync: "Před vysypáním koše synchronizujte položky a vyřešte jejich konflikty.",
      trashClearError: "Koš se nepodařilo vysypat. Položky a čekající změny zůstaly uloženy.",
      trashCleared: "Koš byl zde vysypán; trvalé smazání čeká na synchronizaci.",
      noMatchesHelp: "Zkuste jiný název nebo výraz.",
      close: "Zavřít",
      cancel: "Zrušit",
      confirmMove: "Přesunout položku",
      moveTo: "Přesunout do složky",
      noMatches: "Žádné odpovídající poznámky.",
      label: "Nová položka",
      placeholder: "Název",
      root: "Kořen knihovny",
      createNote: "Vytvořit poznámku Markdown",
      createTypstNote: "Vytvořit poznámku Typst",
      createWhiteboardNote: "Vytvořit tabuli",
      exportSource: "Exportovat zdroj",
      exportPdf: "Exportovat PDF",
      edit: "Upravit",
      split: "Rozdělit",
      preview: "Náhled",
      markdownType: "Markdown",
      typstType: "Typst",
      whiteboardType: "Tabule",
      bold: "Tučně",
      italic: "Kurzíva",
      headingAction: "Nadpis",
      link: "Odkaz",
      list: "Seznam",
      codeBlock: "Blok kódu",
      markdownTools: "Nástroje Markdown",
      content: "Obsah",
      markdownView: "Zobrazení editoru",
      noteLoading: "Načítání poznámky…",
      noteNotFound: "Poznámka v tomto zařízení nebyla nalezena.",
      savingLocal: "Ukládám do tohoto zařízení…",
      markdownDescription: "Textová poznámka s živým náhledem",
      typstDescription: "Matematika, sazba a export do PDF",
      whiteboardDescription: "Upravitelná nekonečná plocha",
      createFolder: "Vytvořit složku",
      tree: "Složky a poznámky",
      empty: "Zatím tu nejsou žádné poznámky.",
      trash: "Koš",
      rename: "Přejmenovat",
      move: "Přesunout",
      remove: "Do koše",
      restore: "Obnovit",
      newName: "Nový název",
      destination: "ID cílové složky, nebo prázdné pro kořen knihovny",
      confirmDelete: (title: string) => `Přesunout „${title}“ do koše?`,
      conflicts: "Konflikty",
      localServerChanged: "Místní i serverová verze obsahují změny.",
      conflictCount: (count: number) =>
        `${count} konflikt${count === 1 ? " synchronizace" : count >= 2 && count <= 4 ? "y synchronizace" : "ů synchronizace"}`,
      conflictCountShort: (count: number) => String(count),
      conflictBanner: "Porovnejte změny a zvolte, kterou verzi zachovat.",
      reviewConflicts: "Zkontrolovat konflikty",
      conflictCenter: "Centrum konfliktů",
      conflictReviewHelp: "Před vyřešením porovnejte místní koncept s aktuální verzí na serveru.",
      reviewConflict: "Zkontrolovat konflikt",
      localVersion: "Místní verze",
      serverVersion: "Verze serveru",
      keepServerHelp: "Použít zde verzi serveru. Místní poznámku zachovat jako kopii pro obnovu v tomto zařízení.",
      keepServerFolderHelp: "Použít název a umístění složky ze serveru. Poznámky a podsložky zůstanou připojené.",
      keepBoth: "Zachovat obě verze",
      keepBothHelp: "Ponechat dokument na serveru a uložit místní verzi jako nový dokument.",
      keepLocal: "Zachovat místní verzi",
      keepLocalHelp: "Nahradit dokument na serveru touto místní verzí. Před zápisem se znovu ověří revize.",
      purgeConflictAction: "Trvale smazat",
      purgeConflictHelp: "Trvale smazat tuto položku také na serveru.",
      restorePurgedAction: "Obnovit místní verzi",
      restorePurgedHelp: "Znovu vytvořit místní verzi na serveru.",
      confirmPurgeConflict: "Opravdu trvale smazat také verzi na serveru? Tuto akci nelze vrátit.",
      confirmRestorePurged: "Obnovit místní verzi na serveru?",
      acceptServerPurge: "Přijmout smazání ze serveru",
      acceptPurgedNoteHelp: "Smazat poznámku i zde a ponechat místní kopii pro obnovu.",
      acceptPurgedFolderHelp: "Smazat složku i zde. Čekající potomci zůstanou k dispozici ke kontrole.",
      confirmAcceptPurge:
        "Přijmout smazání ze serveru? Místní poznámka zůstane jako kopie pro obnovu, pokud je to možné.",
      confirmKeepServer: "Použít verzi serveru? Místní poznámka se zachová jako samostatná kopie.",
      confirmKeepServerFolder:
        "Použít název a umístění složky ze serveru? Místní změny složky budou zahozeny, její poznámky a podsložky zůstanou připojené.",
      conflictNoPreview:
        "Snímky tabule zde nelze zobrazit. Zachováním obou verzí se místní snímek uloží jako samostatná tabule.",
      conflictFolderUnsupported: "Obsah složky se zde nezobrazuje. Před vyřešením porovnejte název a umístění výše.",
      dismissConflictBanner: "Skrýt upozornění na konflikt",
      localCopySuffix: " (místní kopie)",
      conflictError: "Konflikt se nepodařilo vyřešit. Obě verze zůstávají dostupné.",
      conflictResolved: "Vyřešení konfliktu uloženo v tomto zařízení",
      conflictFolder: "Umístění složky",
      conflictModified: "Upraveno",
      conflictRevisions: "Revize",
      conflictDiff: "Rozdíly ve zdroji",
      conflictDiffLarge: "Dokument má více než 500 řádků. Porovnejte celé zdroje vedle sebe níže.",
      lineAdded: "Přidáno",
      lineRemoved: "Odebráno",
      keepServer: "Použít verzi serveru",
      localCopy: "Uložit místní kopii",
      overwriteServer: "Přepsat server…",
      confirmOverwrite: "Přepsat serverovou verzi touto místní verzí?",
      confirmCopy: "Uložit místní verzi jako samostatnou poznámku?",
      syncNow: "Synchronizovat nyní",
      noteType: "Typ poznámky",
      attachImage: "Přidat obrázek",
      writerAcquiring: "Ověřuji, zda tato karta může upravovat…",
      writerLocked: "Tento zápis upravuje jiná karta. Tato karta je pouze pro čtení.",
      writerUnsupported: "Tento prohlížeč neumí bezpečně zamknout zápis. Tato karta je pouze pro čtení.",
      retryWriter: "Zkusit upravovat",
    },
    home: {
      phase: "Místní zápisník",
      heading: "Vaše poznámky zůstávají v tomto zařízení.",
      intro: "Knihovna se ukládá v tomto zařízení. Přihlaste se a synchronizujte změny se svým serverem.",
      draft: "Ukázkový koncept",
      status: {
        loading: "Načítání z tohoto zařízení…",
        loaded: "Načteno z tohoto zařízení",
        saving: "Ukládání do tohoto zařízení…",
        saved: "Uloženo v tomto zařízení",
        readError: "Místní úložiště se nepodařilo načíst",
        saveError: "Do tohoto zařízení se nepodařilo uložit",
        selectRecovery: "Vybrat text konceptu ke zkopírování",
        noteSaved: "Uloženo místně · čeká na synchronizaci",
        titleRequired: "Zadejte název poznámky.",
        createError: "Místní poznámku se nepodařilo vytvořit",
      },
      newNote: "Nová poznámka Markdown",
      create: "Vytvořit poznámku",
      notes: "Místní poznámky",
      savedLocally: "uloženo místně · čeká na synchronizaci",
      prototypes: "Ukázky editorů",
      typst: "Ukázka editoru Typst",
      whiteboard: "Ukázka tabule",
    },
    typst: {
      title: "Ukázka editoru Typst",
      exportPdf: "Exportovat PDF",
      intro:
        "Kompilace probíhá místně ve webovém Workeru s přibaleným WebAssembly a fonty. Otevřete stránku online a pak ověřte kompilaci offline.",
      compile: "Kompilovat PDF",
      starting: "Načítání přibaleného kompilátoru Typst…",
      compiled: "PDF zkompilováno",
      failed: "Kompilace selhala",
      source: "Zdrojový kód Typst",
      preview: "Náhled",
      switchView: "Editor Typst a náhled",
      pdfOutput: "Výstupní PDF",
      zoomIn: "Přiblížit",
      zoomOut: "Oddálit",
      resetZoom: "Přizpůsobit šířce",
      emptyPreview: "Zde se zobrazí náhled PDF",
      stalePreview: "Zobrazuje se poslední úspěšné PDF · zdroj obsahuje chyby",
      notStarted: "Kompilátor nebyl spuštěn",
    },
    whiteboard: {
      title: "Ukázka SDK tabule",
      intro:
        "Vývojový editor. Importované obrázky se ukládají místně; Papyr ukládá upravitelný snímek dokumentu zvlášť do IndexedDB.",
      save: "Uložit upravitelný snímek",
      exportSnapshot: "Stáhnout upravitelný snímek",
      exportPng: "Exportovat PNG",
      exportSvg: "Exportovat SVG",
      export: "Exportovat",
      fit: "Přizpůsobit plochu obrazovce",
      exportError: "Tabuli se nepodařilo exportovat",
      loading: "Načítání uloženého snímku…",
      loadError: "Uložený snímek se nepodařilo načíst",
      ready: "Připraveno · změny se automaticky ukládají v tomto zařízení",
      saving: "Ukládání snímku…",
      saved: "Uloženo místně",
      enterFullscreen: "Zobrazit na celou obrazovku",
      exitFullscreen: "Ukončit celou obrazovku",
      saveError: "Snímek se nepodařilo uložit",
      unavailable: "Tabule není dostupná",
      license: "Produkční provoz je zablokován, dokud není nastaven platný licenční klíč tldraw.",
    },
  },
} as const;

export type Locale = keyof typeof messages;

let inMemoryLocale: Locale = "en";

function getLocaleSnapshot(): Locale {
  try {
    const saved = localStorage.getItem("papyr-locale");
    if (saved === "cs" || saved === "en") return saved;
  } catch {
    // Keep the current language for this page session if browser storage is unavailable.
  }
  return inMemoryLocale;
}

function subscribeToLocale(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("papyr-locale-change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("papyr-locale-change", callback);
  };
}

function setStoredLocale(locale: Locale) {
  inMemoryLocale = locale;
  try {
    localStorage.setItem("papyr-locale", locale);
  } catch {
    // Keep language changes available in memory when browser storage is unavailable.
  }
  window.dispatchEvent(new Event("papyr-locale-change"));
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const locale = useSyncExternalStore<Locale>(subscribeToLocale, getLocaleSnapshot, () => "en");

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const theme = useSyncExternalStore<Theme>(subscribeToTheme, getThemeSnapshot, () => "system");
  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyThemeColor = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches);
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#202629" : "#f5f3ee");
    };
    applyThemeColor();
    media.addEventListener("change", applyThemeColor);
    return () => media.removeEventListener("change", applyThemeColor);
  }, [theme]);

  return <>{children}</>;
}

type Theme = "system" | "light" | "dark";
let inMemoryTheme: Theme = "system";
function getThemeSnapshot(): Theme {
  try {
    const theme = localStorage.getItem("papyr-theme");
    if (theme === "light" || theme === "dark") return (inMemoryTheme = theme);
    inMemoryTheme = "system";
  } catch {
    // Fall back to the operating-system preference.
  }
  return inMemoryTheme;
}
function subscribeToTheme(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("papyr-theme-change", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("papyr-theme-change", callback);
  };
}
function ThemeControl({ locale, theme }: { locale: Locale; theme: Theme }) {
  const copy = messages[locale].common;
  const next: Theme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
  const label = copy[theme];
  return (
    <button
      className="theme-control"
      type="button"
      aria-label={`${copy.theme}: ${label}`}
      onClick={() => {
        try {
          if (next === "system") localStorage.removeItem("papyr-theme");
          else localStorage.setItem("papyr-theme", next);
        } catch {
          // The selected theme remains active for this page session.
        }
        inMemoryTheme = next;
        window.dispatchEvent(new Event("papyr-theme-change"));
      }}
    >
      {label}
    </button>
  );
}

export function useLocale() {
  return messages[useCurrentLocale()];
}

export function useCurrentLocale() {
  return useSyncExternalStore<Locale>(subscribeToLocale, getLocaleSnapshot, () => "en");
}

function LocaleControl({ locale }: { locale: Locale }) {
  const nextLocale = locale === "en" ? "cs" : "en";
  const copy = messages[locale].common;
  return (
    <button
      className="locale-control"
      type="button"
      lang={nextLocale}
      aria-label={`${copy.language} · ${copy.switchLanguage}`}
      onClick={() => setStoredLocale(nextLocale)}
    >
      {copy.language}
    </button>
  );
}

export function LocaleSettingsControls() {
  const locale = useCurrentLocale();
  const theme = useSyncExternalStore<Theme>(subscribeToTheme, getThemeSnapshot, () => "system");
  return (
    <div className="preferences-controls">
      <ThemeControl locale={locale} theme={theme} />
      <LocaleControl locale={locale} />
    </div>
  );
}
