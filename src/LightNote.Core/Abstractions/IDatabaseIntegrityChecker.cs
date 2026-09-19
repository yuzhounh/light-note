using LightNote.Core.Models;

namespace LightNote.Core.Abstractions;

public interface IDatabaseIntegrityChecker
{
    Task<DatabaseIntegrityResult> CheckAsync(CancellationToken cancellationToken = default);
}
