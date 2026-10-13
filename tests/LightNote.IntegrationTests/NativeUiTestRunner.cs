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
                default:
                    throw new ArgumentException("Specify message-dialog, sidebar, window-controls or title-editing.");
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
