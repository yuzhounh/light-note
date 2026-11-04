namespace LightNote.IntegrationTests;

// A regular executable host is required for self-contained WinRT activation; VSTest owns its own host.
internal static class NativeUiTestRunner
{
    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            if (!Microsoft.UI.Windowing.AppWindowTitleBar.IsCustomizationSupported())
                throw new InvalidOperationException("This host must support native title bar customization.");
            switch (args.SingleOrDefault())
            {
                case "message-dialog":
                    new MessageDialogTests().ThemedModalPreservesConfirmationDismissalAndLongMessageBehavior();
                    break;
                case "sidebar":
                    new SidebarContextMenuTests().RealSidebarRoutesRowTextBackgroundButtonsAndKeyboardWithoutChangingSelection();
                    break;
                case "window-controls":
                    new NativeCaptionTests().VerifyWindowControlsAndCancelableClose();
                    break;
                case "title-editing":
                    new TitleEditingTests().RefreshAndSavePreserveTheTitleTextAndCaret();
                    break;
                case "image-paste":
                    new ImagePasteResponsivenessTests().PasteScreenshotsWhileContinuingToType();
                    break;
                case "table-sizing":
                    new TableSizingTests().VerifyTableSizing();
                    break;
                case "caret-scrolling":
                    new CaretScrollingTests().VerifyCaretScrolling();
                    break;
                case "editor-menu":
                    var dispatcher = System.Windows.Threading.Dispatcher.CurrentDispatcher;
                    SynchronizationContext.SetSynchronizationContext(new System.Windows.Threading.DispatcherSynchronizationContext(dispatcher));
                    Exception? menuFailure = null;
                    dispatcher.BeginInvoke(new Action(async () =>
                    {
                        try { await new EditorContextMenuTests().VerifyAsync(); }
                        catch (Exception exception) { menuFailure = exception; }
                        finally { dispatcher.BeginInvokeShutdown(System.Windows.Threading.DispatcherPriority.Background); }
                    }));
                    System.Windows.Threading.Dispatcher.Run();
                    if (menuFailure is not null) System.Runtime.ExceptionServices.ExceptionDispatchInfo.Capture(menuFailure).Throw();
                    break;
                case "tray-exit":
                    new TrayExitTests().ExitingTrayInstanceClosesWithoutSaveFailure();
                    break;
                default:
                    throw new ArgumentException("Specify message-dialog, sidebar, window-controls, title-editing, image-paste, table-sizing, caret-scrolling or tray-exit.");
            }
            Console.WriteLine($"Native UI verification passed: {args[0]}");
            return 0;
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine(exception);
            return 1;
        }
    }
}
